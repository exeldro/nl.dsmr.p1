'use strict';

const Homey = require('homey');

class DsmrApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('DsmrApp has been initialized');
  }
}

module.exports = DsmrApp;