'use strict';

const Homey = require('homey');
var net = require('net');
var parser = require('dsmr-parser');

class DsmrDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('DsmrDevice has been initialized '+ this.getSetting('ip')+':'+ this.getSetting('port'));

    this.values = {};
    var self = this;
	  // Set up network communication
    this.client = new net.Socket();
    this.client.setTimeout(60000); // expect traffic once a minute
    // Register main response handler
    this.client.on('data', function(data) {
      //clearTimeout(waitTimer);
      self.processData(data);
    });
    // Error handler
    this.client.on('error', function(err) {
      self.log(err);
      if (!self.found) {
        //clearTimeout(waitTimer);
        self.closeConnection();
      }
    });
    // Timeout handler
    this.client.on('timeout', function() {
      self.log('Connecion timed out.');
      self.closeConnection();
    });
    // Handle closed connections, try to re-open it
    this.client.on('close', function() {
      self.log('Connecion closed (found =', self.found + ')');
      self.events.emit('found', { found: false, err: 'Connection closed' });
      if (self.found && self.reconnectTimer === undefined) {
        // Connection dropped, try to re-connect every minute
        self.reconnectTimer = setInterval(function() {
          var ip = self.settings.ip;
          var port = self.settings.port;
          self.log('Re-connecting to', ip + ':' + port);
          self.openConnection(ip, port);
        }, 60000);
      }
    });
    this.client.connect(this.getSetting('port'), this.getSetting('ip'), function() {
      self.log('Connected to ' + self.getSetting('ip')+':'+self.getSetting('port'));
      // Kill the re-try timer
      clearInterval(self.reconnectTimer);
      self.reconnectTimer = undefined;
    });
  }

  processData(data) {
    if (data == null || data.length <= 0)
      return;
    data = data.toString();
    //this.log('>>>' + data.replace(/\r\n/g, '_') + '<<<');
    // Message (v4): /XXXZ Ident CR LF CR LF Data ! CRC CR LF
    if (data[0] == '/') {
      this.incomingTelegram = data;
      // Request producer power on new message if no accurate timing yet
      if (this.getSetting('onTime') == false || this.producerTimer == null) {
        //TODO this.events.emit('newMessage');
      }
    } else {
      this.incomingTelegram += data;
    }
    if (this.incomingTelegram[0] == '/'
        && this.incomingTelegram.lastIndexOf('!') >= 0
        && this.incomingTelegram.slice(-2) === '\r\n')
    {
      var telegram;
      var ok = true;
      try {
        telegram = parser.parse(this.incomingTelegram);
      } catch(err) {
        this.log('Telegram decode error:', err);
        ok = false;
      }
      if (ok) {
        /*for (var i in telegram.objects) {
          this.log(i + ':', telegram.objects[i]);
        }*/
        // Process objects
        this.updateValue('actualWattDel', 1000 * telegram.objects['actual electricity power delivered']);
        this.updateValue('actualWattRec', 1000 * telegram.objects['actual electricity power received']);
        this.updateValue('actualWatt', this.values.actualWattDel - this.values.actualWattRec);
        
        this.updateValue('sumKwhDelT1', telegram.objects['electricity delivered tariff 1']);
        this.updateValue('sumKwhDelT2', telegram.objects['electricity delivered tariff 2']);
        this.updateValue('sumKwhRecT1', telegram.objects['electricity received tariff 1']);
        this.updateValue('sumKwhRecT2', telegram.objects['electricity received tariff 2']);
        this.updateValue('sumKwhT1', this.values.sumKwhDelT1 - this.values.sumKwhRecT1);
        this.updateValue('sumKwhT2', this.values.sumKwhDelT2 - this.values.sumKwhRecT2);
        this.updateValue('sumKwhDel', this.values.sumKwhDelT1 + this.values.sumKwhDelT1);
        this.updateValue('sumKwhRec', this.values.sumKwhRecT2 + this.values.sumKwhRecT2);
        this.updateValue('sumKwh', this.values.sumKwhT1 + this.values.sumKwhT2);
        // Gas
        var oldGas = this.values.sumGas;
        var oldGasTime = this.values.tsGas;
        this.updateValue('sumGas', telegram.objects['gas delivered']);
        if (this.updateValue('tsGas', telegram.objects['gas timestamp']) && oldGasTime != null) {
          var diffGas = (this.values.sumGas - oldGas) * 1000;
          var diffHr = this.values.tsGas.getUTCHours() - oldGasTime.getUTCHours();
          //this.log('Hours:liters', diffHr, ':', diffGas);
          if (diffHr > 0) {
            this.updateValue('flowGas', diffGas / diffHr);
          }
        };
        // For pairing
        if (!this.found) {
          this.found = true;
          this.config = { 
            id: telegram.objects['equipment identifier'],
            gid: telegram.objects['gas equipment identifier'],
            name: telegram.identifier,
            version: telegram.objects['dsmr version']
          };
          /*this.events.emit('found', { 
            found: true, 
            config: this.config
          });*/
        }
        if (this.getSetting('onTime')) {
          // Measure producer power as close as possible to DSMR measurement
          this.timeDelta = 10000 - (new Date() - telegram.objects['timestamp']) + (this.getSetting('timeOffset') || 0);
          this.timeDelta = Math.min(Math.max(0, this.timeDelta), 10000);
          //this.log('Time delta:', this.timeDelta);
          var self = this;
          this.producerTimer = setTimeout(function() {
            //self.events.emit('newMessage');
          }, this.timeDelta);
        }
      } else if (!this.found) {
        //this.events.emit('found', { found: false } );
      }
    }
  }

  updateValue(what, newVal) {
    var curVal = this.values[what];
    var changed = curVal == null || (newVal instanceof Date ? newVal.getTime() !== curVal.getTime() : newVal != curVal);
    if (changed) {
      this.log(what + ': was ' + curVal + ' now ' + newVal);
      this.values[what] = newVal;
      //state.events.emit(what, newVal);
      if(what == 'actualWatt'){
        this.setCapabilityValue('measure_power',newVal);
      }else if(what == 'sumKwh'){
        this.setCapabilityValue('meter_power',newVal);
      }else if(what == 'sumGas'){
        this.setCapabilityValue('meter_gas',newVal);
      }else if(what == 'flowGas'){
        this.setCapabilityValue('flow_gas',newVal);
      }
      return true;
    } else {
      return false;
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('DsmrDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('DsmrDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('DsmrDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('DsmrDevice has been deleted');
  }
}

module.exports = DsmrDevice;
