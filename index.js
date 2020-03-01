/*
 * Copyright 2020 Jeremy Carter <jncarter@hotmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.

 Assistance with reading data from analyzr came from https://github.com/sbender9/signalk-victron-battery-monitor.

 Switch Control code came https://github.com/sbender9/signalk-n2k-switching.

 the findDeviceByInstance method was adapted from https://github.com/sbender9/signalk-fusion-stereo.
 */

const _ = require('lodash')

module.exports = function(app) {
  var plugin = {};
  var n2kCallback = undefined
  var state = {}

  plugin.id = "signalk-n2k-switching-translator"
  plugin.name = "NMEA 2000 Switching Translator"
  plugin.description = "There is a standard set of PGNs for switch control, however some equipment manufacturers use the Command PGN for control. This plugin translates between the two."

  plugin.schema = {
    type: "object",
    properties: {
      convertSwitchControlToCommand: {
        type: 'boolean',
        title: 'For every Switch Control (PGN 127502) received, a Command (PGN 126208) will be sent.',
        default: false
      },
      convertCommandToSwitchControl: {
        type: 'boolean',
        title: 'For every Command (PGN 126208) containing a Switch Status update, a Switch Control (PGN 127502) will be sent.',
        default: false
      }
    }
  }

  plugin.start = function(options) {
    pluginOptions = options

    n2kCallback = (msg) => {
      try {
        var enc_msg = null

        var fields = msg['fields']

        if (pluginOptions.convertSwitchControlToCommand === true && msg.pgn == 127502) {

          app.debug('Converting PGN 127502 to 126208')
          app.debug('msg: ' + JSON.stringify(msg))

          let instance = fields['Switch Bank Instance']

          let switchKey = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()

          let switchNum = switchKey.match(/\d+/g).map(Number)
          //the command parameter for the switch number is shifted by one due to the first parameter being the instance
          switchNum++

          let value = fields[switchKey] === 'On' ? 1 : 0

          //dst is required
          let device = findDeviceByInstance(instance)
          app.debug('Found device: ' + JSON.stringify(device))
          let dst = device.src

          const commandPgn = {
            "pgn": 126208,
            "dst": dst,
            "prio": 3,
            "fields": {
              "Function Code": "Command",
              "PGN": 127501,
              "Priority": 8,
              "# of Parameters": 2,
              "list": [{
                  "Parameter": 1,
                  "Value": instance
                },
                {
                  "Parameter": switchNum,
                  "Value": value
                }
              ]
            }
          }

          app.debug('sending command %j', commandPgn)
          app.emit('nmea2000JsonOut', commandPgn)

        } else if (pluginOptions.convertCommandToSwitchControl === true && msg.pgn == 126208) {
          if (fields['Function Code'] == 'Command' && fields['PGN'] == 127501) {
            app.debug('Converting Command PGN 126280 to Switch Control 127502')
            app.debug('msg: ' + JSON.stringify(msg))

            let dst = 255
            let instance = fields['list'][0].Value
            let switchNum = fields['list'][1].Parameter
            switchNum--
            let value = fields['list'][1].Value

            const pgn = {
              pgn: 127502,
              dst: dst,
              "Switch Bank Instance": instance
            }

            pgn[`Switch${switchNum}`] = value === 1 || value === 'on' ? 'On' : 'Off'

            app.debug('sending %j', pgn)
            app.emit('nmea2000JsonOut', pgn)
          }
        }

      } catch (e) {
        console.error(e)
      }
    }
    app.on("N2KAnalyzerOut", n2kCallback)
  }

  function findDeviceByInstance(instance) {
    const sources = app.getPath('/sources')
    if (sources) {
      const devices = []
      _.values(sources).forEach(v => {
        if (typeof v === 'object') {
          _.keys(v).forEach(id => {
            if (v[id] && v[id].n2k && v[id].n2k.hardwareVersion && v[id].n2k.deviceFunction === 140) {
              //The combination of fields 3 & 4 make up the 8 bit NMEA Instance.
              var lower = v[id].n2k.deviceInstanceLower.toString(2)
              var upper = v[id].n2k.deviceInstanceUpper.toString(2)
              var deviceInstance = parseInt(upper + lower, 2)

              if (deviceInstance === instance) {
                devices.push(v[id].n2k)
              }
            }
          })
        }
      })
      if (devices.length) {
        return devices[0]
      }
    }
  }

  plugin.stop = function() {
    if (n2kCallback) {
      app.removeListener("N2KAnalyzerOut", n2kCallback)
      n2kCallback = undefined
    }
  }

  return plugin
}
