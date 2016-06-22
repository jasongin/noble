var events = require('events');
var util = require('util');

var debug = require('debug')('noble-uwp');

var uwp = require('uwp');
uwp.projectNamespace("Windows");
var using = ns => Object.keys(ns).forEach(t => global[t] = ns[t]);

using(Windows.Devices.Bluetooth);
using(Windows.Devices.Bluetooth.Advertisement);
using(Windows.Devices.Bluetooth.GenericAttributeProfile);
using(Windows.Devices.Enumeration);
using(Windows.Devices.Radios);
using(Windows.Storage.Streams);

function debugErrors(fn) {
  return function () {
    try {
      return fn.apply(null, arguments);
    } catch (error) {
      debug(error.stack);
    }
  };
}

var NobleBindings = function() {
  this._radio = null;
  this._radioState = 'unknown';
  this._deviceMap = {};
};

util.inherits(NobleBindings, events.EventEmitter);

NobleBindings.prototype.init = function() {
  this._advertisementWatcher = new BluetoothLEAdvertisementWatcher();
  this._advertisementWatcher.scanningMode = BluetoothLEScanningMode.active;
  this._advertisementWatcher.addEventListener('received', debugErrors(this._onAdvertisementWatcherReceived.bind(this)));
  this._advertisementWatcher.addEventListener('stopped', debugErrors(this._onAdvertisementWatcherStopped.bind(this)));

  debug('initialized');

  Radio.getRadiosAsync().then(radiosList => {
    this._radio = radiosList.find(radio => radio.kind === RadioKind.bluetooth);
    if (this._radio) {
      debug('found bluetooth radio: ' + this._radio.name);
    } else {
      debug('no bluetooth radio found');
    }
    this._updateRadioState();
  }, error => {
    debug('failed to get radios: ' + e.message);
  });
};

NobleBindings.prototype.startScanning = function(serviceUuids, allowDuplicates) {
  allowDuplicates = !!allowDuplicates;
  debug('startScanning(' + (serviceUuids ? serviceUuids.join() : '') + ', ' + allowDuplicates + ')');
  this._advertisementWatcher.start();
};

NobleBindings.prototype.stopScanning = function() {
  debug('stopScanning()');
  this._advertisementWatcher.stop();
};

NobleBindings.prototype.connect = function(deviceUuid) {
  debug('connect(' + deviceUuid + ')');
};

NobleBindings.prototype.disconnect = function(deviceUuid) {
  debug('disconnect(' + deviceUuid + ')');
};

NobleBindings.prototype.updateRssi = function(deviceUuid) {
  debug('updateRssi(' + deviceUuid + ')');
};

NobleBindings.prototype.discoverServices = function(deviceUuid, uuids) {
  debug('discoverServices(' + deviceUuid + ', ' + (uuids ? uuids.join() : '') + ')');
};

NobleBindings.prototype.discoverIncludedServices = function(deviceUuid, serviceUuid, serviceUuids) {
  debug('discoverIncludedServices(' + deviceUuid + ', ' + serviceUuid + ', ' + (serviceUuids ? serviceUuids.join() : '') + ')');
};

NobleBindings.prototype.discoverCharacteristics = function(deviceUuid, serviceUuid, characteristicUuids) {
  debug('discoverCharacteristics(' + deviceUuid + ', ' + serviceUuid + ', ' + (characteristicUuids ? characteristicUuids.join() : '') + ')');
};

NobleBindings.prototype.read = function(deviceUuid, serviceUuid, characteristicUuid) {
  debug('read(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ')');
};

NobleBindings.prototype.write = function(deviceUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
  debug('write(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', (data), ' + withoutResponse + ')');
};

NobleBindings.prototype.broadcast = function(deviceUuid, serviceUuid, characteristicUuid, broadcast) {
  debug('broadcast(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + broadcast + ')');
};

NobleBindings.prototype.notify = function(deviceUuid, serviceUuid, characteristicUuid, notify) {
  debug('notify(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + notify + ')');
};

NobleBindings.prototype.discoverDescriptors = function(deviceUuid, serviceUuid, characteristicUuid) {
  debug('discoverDescriptors(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ')');
};

NobleBindings.prototype.readValue = function(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid) {
  debug('readValue(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + descriptorUuid + ')');
};

NobleBindings.prototype.writeValue = function(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
  debug('writeValue(' + deviceUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + descriptorUuid + ', (data))');
};

NobleBindings.prototype.readHandle = function(deviceUuid, handle) {
  debug('readHandle(' + deviceUuid + ', ' + handle + ')');
};

NobleBindings.prototype.writeHandle = function(deviceUuid, handle, data, withoutResponse) {
  debug('readHandle(' + deviceUuid + ', ' + handle + ', (data), ' + withoutResponse + ')');
};

NobleBindings.prototype._updateRadioState = function() {
  var state;

  if (!this._radio) {
    state = 'unsupported';
  } else switch (this._radio.state) {
    case RadioState.on:
      debug('bluetooth radio is on');
      state = 'poweredOn';
      break;
    case RadioState.off:
      debug('bluetooth radio is off');
      state = 'poweredOff';
      break;
    case RadioState.disabled:
      debug('bluetooth radio is disabled');
      state = 'poweredOff';
      break;
    default:
      debug('bluetooth radio is in unknown state: ' + this._bluetoothRadio.state);
      state = 'unknown';
      break;
  }

  if (state != this._radioState) {
    this._radioState = state;
    this.emit('stateChange', state);
  }
}

NobleBindings.prototype._onAdvertisementWatcherReceived = function(e) {
  var address = formatBluetoothAddress(e.bluetoothAddress);
  debug('watcher received: ' + address + ' ' + e.advertisement.localName);

  e.advertisement.dataSections.forEach(dataSection => {
    debug('    data section: ' + (getAdvertisementDataTypeName(dataSection.dataType) || dataSection.dataType));
  });

  debug('    flags: ' + e.advertisement.flags);

  var deviceUuid = address.replace(/:/g, '');
  var rssi = e.rawSignalStrengthInDBm;

  var connectable;
  switch (e.advertisementType) {
    case BluetoothLEAdvertisementType.connectableUndirected:
    case BluetoothLEAdvertisementType.connectableDirected:
      connectable = true;
      break;
    default:
      connectable = false;
      break;
  }
  //debug('    connectable: ' + connectable);

  var txPowerLevel = null;
  var txPowerDataSection = e.advertisement.dataSections.find(
    ds => ds.dataType === BluetoothLEAdvertisementDataTypes.txPowerLevel);
  if (txPowerDataSection) {
    var dataReader = DataReader.fromBuffer(txPowerDataSection.data);
    txPowerLevel = dataReader.readByte();
    if (txPowerLevel >= 128) txPowerLevel -= 256;
    dataReader.close();
  }

  var serviceUuids = null;
  if (e.advertisement.serviceUuids.length > 0) {
    serviceUuids = [];
    e.advertisement.serviceUuids.forEach(serviceUuid => {
      debug('    service UUID: ' + (getGattServiceName(serviceUuid) || serviceUuid));
      serviceUuids.push(serviceUuid);
    });
  }

  var addressType = 'unknown';

  /*
  BluetoothLEDevice.fromBluetoothAddressAsync(e.bluetoothAddress).then(debugErrors(device => {
    debug('got bluetooth device: ' + device.name);

    switch (device.bluetoothAddressType) {
      case BluetoothAddressType.public: addressType = 'public'; break;
      case BluetoothAddressType.random: addressType = 'random'; break;
      default: addressType = 'unknown'; break;
    }

    GattDeviceService.fromIdAsync(device.deviceId).then(deviceService => {
      debug('got device service');
    }, error => {
      debug('failed to get device service: ' + error.message);
    });

    this.emit('discover', deviceUuid, address, addressType, connectable, advertisement, rssi);
  }), error => {
    debug('failed to get device ' + address + ': ' + error.message);
  });
  */

  var deviceRecord = this._deviceMap[deviceUuid];
  if (!deviceRecord) {
    deviceRecord = {
      name: null,
      address: address,
      addressType: addressType,
      connectable: connectable,
      serviceUuids: [],
      txPowerLevel: null,
    };
    this._deviceMap[deviceUuid] = deviceRecord;
  }

  if (e.advertisement.localName) {
    deviceRecord.name = e.advertisement.localName;
  }
  if (serviceUuids) {
    serviceUuids.forEach(serviceUuid => {
      if (deviceRecord.serviceUuids.indexOf(serviceUuid) < 0) {
        deviceRecord.serviceUuids.push(serviceUuid);
      }
    });
  }
  if (txPowerLevel) {
    deviceRecord.txPowerLevel = txPowerLevel;
  }

  var advertisement = {
    localName: deviceRecord.name,
    txPowerLevel: deviceRecord.txPowerLevel,
    manufacturerData: null, // TODO: manufacturerData
    serviceUuids: deviceRecord.serviceUuids,
    serviceData: [], // TODO: serviceData
  };

  // Wait until a name is received before "discovering" this device. The (second) advertisement packet,
  // in response to the active query, should contain a name.
  if (deviceRecord.name) {
    this.emit('discover', deviceUuid, address, deviceRecord.addressType, deviceRecord.connectable, advertisement, rssi);
  }
}

NobleBindings.prototype._onAdvertisementWatcherStopped = function(e) {
  if (this._advertisementWatcher.status === BluetoothLEAdvertisementWatcherStatus.aborted) {
    debug('watcher aborted');
  } else if (this._advertisementWatcher.status === BluetoothLEAdvertisementWatcherStatus.stopped) {
    debug('watcher stopped');
  } else {
    debug('watcher stopped with unexpected status: ' + this._advertisementWatcher.status);
  }
}

function formatBluetoothAddress(address) {
  var formattedAddress = address.toString(16);
  while (formattedAddress.length < 12) {
    formattedAddress = '0' + formattedAddress;
  }
  formattedAddress =
    formattedAddress.substr(0, 2) + ':' +
    formattedAddress.substr(2, 2) + ':' +
    formattedAddress.substr(4, 2) + ':' +
    formattedAddress.substr(6, 2) + ':' +
    formattedAddress.substr(8, 2) + ':' +
    formattedAddress.substr(10, 2);
  return formattedAddress;
}

function getGattServiceName(serviceUuid) {
  return Object.keys(GattServiceUuids).find(gattServiceName =>
    serviceUuid === GattServiceUuids[gattServiceName]);
}

function getAdvertisementDataTypeName(dataType) {
  return Object.keys(BluetoothLEAdvertisementDataTypes).find(advertisementDataTypeName =>
    dataType === BluetoothLEAdvertisementDataTypes[advertisementDataTypeName]);
}

module.exports = new NobleBindings();
