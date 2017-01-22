var events = require('events');
var util = require('util');

var debug = require('debug')('noble-uwp');

var Windows = {
  Devices: {},
  Storage: {},
};
Windows.Foundation = require('@nodert-win10/windows.foundation');
Windows.Devices.Bluetooth = require('@nodert-win10/windows.devices.bluetooth');
Windows.Devices.Bluetooth.Advertisement =
  require('@nodert-win10/windows.devices.bluetooth.advertisement');
Windows.Devices.Bluetooth.GenericAttributeProfile =
  require('@nodert-win10/windows.devices.bluetooth.genericattributeprofile');
Windows.Devices.Enumeration = require('@nodert-win10/windows.devices.enumeration');
Windows.Devices.Radios = require('@nodert-win10/windows.devices.radios');
Windows.Storage.Streams = require('@nodert-win10/windows.storage.streams');

// Convert NodeRT's async methods to use promises.
function promisifyRtMethod(fn) {
  return (...args) => {
    return new Promise((resolve, reject) => {
      fn(...args, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  };
}

function promisifyRtType(t) {
  Object.keys(t).forEach(m => {
    if (m.endsWith('Async') && typeof t[m] == 'function') {
      t[m] = promisifyRtMethod(t[m]);
    }
  });
}

function using(ns) {
  Object.keys(ns).forEach(t => {
    promisifyRtType(ns[t]);
    global[t] = ns[t];
  });
}

function rtVectorToArray(v) {
  var a = new Array(v.length);
  for (var i = 0; i < a.length; i++) {
    a[i] = v[i];
  }
  return a;
}

function rtMapToObject(m) {
  var o = {};
  for (var i = m.first(); i.hasCurrent; i.moveNext()) {
    o[i.current.key] = i.current.value;
  }
  return o;
}

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
  this._advertisementWatcher.on('received', debugErrors(this._onAdvertisementWatcherReceived.bind(this)));
  this._advertisementWatcher.on('stopped', debugErrors(this._onAdvertisementWatcherStopped.bind(this)));

  debug('initialized');

  Radio.getRadiosAsync().then(radiosList => {
    radiosList = rtVectorToArray(radiosList);
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
  this._advertisementTimeoutId = setTimeout(() => {}, 10000000);
};

NobleBindings.prototype.stopScanning = function() {
  debug('stopScanning()');
  this._advertisementWatcher.stop();
  clearTimeout(this._advertisementTimeoutId);
};

NobleBindings.prototype.connect = function(deviceUuid) {
  debug('connect(' + deviceUuid + ')');

  var deviceRecord = this._deviceMap[deviceUuid];
  if (!deviceRecord) {
    throw new Error('Invalid or unknown device UUID: ' + deviceUuid);
  }

  if (!deviceRecord.connectable) {
    throw new Error("Device is not connectable: " + deviceRecord.formattedAddress);
  }

  BluetoothLEDevice.fromBluetoothAddressAsync(deviceRecord.address).then(debugErrors(device => {
    debug('got bluetooth device: ' + device.name + ' (' + device.deviceInformation.kind + ')');
    deviceRecord.device = device;

    var deviceProperties = rtMapToObject(device.deviceInformation.properties);
    Object.keys(deviceProperties).forEach(propertyKey => {
      var v = deviceProperties[propertyKey];
      
      if (typeof v === 'object') {
        v.__proto__ = Windows.Foundation.IPropertyValue.prototype;
      }

      debug('    ' + propertyKey + ' = ' + v);
    });

    var deviceServices = rtVectorToArray(device.gattServices);
    deviceServices.forEach(s => {
      debug('    service: ' + s);
    });

    /*
    if (device.deviceInformation.pairing && device.deviceInformation.pairing.canPair) {
      if (device.deviceInformation.pairing.isPaired) {
        debug('device: ' + deviceRecord.formattedAddress + ' is already paired');
        this.emit('connect', deviceUuid);
      } else {
        device.deviceInformation.pairing.pairAsync().then(debugErrors(pairingResult => {
          debug('paired device: ' + deviceRecord.formattedAddress + ' with status: ' + pairingResult.status);
          this.emit('connect', deviceUuid);
        }), error => {
          debug('failed to pair device ' + deviceRecord.formattedAddress + ': ' + error.message);
          this.emit('connect', deviceUuid, error);
        });
      }
    } else {
      debug('unable to pair device: ' + deviceRecord.formattedAddress);
      this.emit('connect', deviceUuid, error);
    }
    */
  }), error => {
    debug('failed to get device ' + deviceRecord.formattedAddress + ': ' + error.message);
    this.emit('connect', deviceUuid, error);
  });
};

NobleBindings.prototype.disconnect = function(deviceUuid) {
  debug('disconnect(' + deviceUuid + ')');

  // TODO: device.deviceInformation.pairing.unpairAsync
};

NobleBindings.prototype.updateRssi = function(deviceUuid) {
  debug('updateRssi(' + deviceUuid + ')');
};

NobleBindings.prototype.discoverServices = function(deviceUuid, uuids) {
  debug('discoverServices(' + deviceUuid + ', ' + (uuids ? uuids.join() : '(all)') + ')');

  var deviceRecord = this._deviceMap[deviceUuid];
  if (!deviceRecord) {
    throw new Error('Invalid or unknown device UUID: ' + deviceUuid);
  }

  var device = deviceRecord.device;
  if (!device) {
    throw new Error('Device is not connected. UUID: ' + deviceUuid);
  }

  var serviceUuid = deviceRecord.serviceUuids[0];
  var selector = GattDeviceService.getDeviceSelectorFromUuid(serviceUuid);
  selector += ' AND System.DeviceInterface.Bluetooth.DeviceAddress:="' + deviceUuid + '"';
  selector += ' AND System.Devices.InterfaceClassGuid:=\"{6E3BB679-4372-40C8-9EAA-4509DF260CD8}\"';
  selector += ' AND System.Devices.InterfaceEnabled:=System.StructuredQueryType.Boolean#True';

  debug('service selector: ' + selector);
  DeviceInformation.findAllAsync(selector).then(serviceInfos => {
    debug('got services: ' + serviceInfos.length);
    serviceInfos.forEach(serviceInfo => {
      debug(serviceInfo.id);
      /*
      Object.keys(device.deviceInformation.properties).forEach(propertyKey => {
        debug('    ' + propertyKey + ' = ' + device.deviceInformation.properties[propertyKey]);
      });
      */
    });
    /*
    if (services.length === 1) {
      Object.keys(deviceInfo.properties).forEach(propertyKey => {
        debug('    ' + propertyKey + ' = ' + deviceInfo.properties[propertyKey]);
      });

      var containerId = deviceInfo.properties["System.Devices.ContainerId"];
      selector =  'System.Devices.ContainerId:=\"' + containerId + '\" ' +
        ' AND System.Devices.InterfaceClassGuid:=\"{6E3BB679-4372-40C8-9EAA-4509DF260CD8}\" ' +
        'AND System.Devices.InterfaceEnabled:=System.StructuredQueryType.Boolean#True';
      debug('services selector: ' + selector);
      DeviceInformation.findAllAsync(selector, null).then(services => {
        debug('got services: ' + services.length);
      }, error => {
        debug('failed to get services: ' + error.message);
      });
    }
    */
  }, error => {
    debug('failed to get services: ' + error.message);
  });

  /*
   'System.Devices.ContainerId:=\"' + device.deviceId + '\" ' +
    //' AND System.Devices.InterfaceClassGuid:=\"{6E3BB679-4372-40C8-9EAA-4509DF260CD8}\" ' +
    'AND System.Devices.InterfaceEnabled:=System.StructuredQueryType.Boolean#True';
  debug('services selector: ' + selector);
  DeviceInformation.findAllAsync(selector, null).then(services => {
    debug('got services: ' + services.length);
  }, error => {
    debug('failed to get services: ' + error.message);
  });
  */
};

NobleBindings.prototype.discoverIncludedServices = function(deviceUuid, serviceUuid, serviceUuids) {
  debug('discoverIncludedServices(' + deviceUuid + ', ' + serviceUuid + ', ' + (serviceUuids ? serviceUuids.join() : '(all)') + ')');
};

NobleBindings.prototype.discoverCharacteristics = function(deviceUuid, serviceUuid, characteristicUuids) {
  debug('discoverCharacteristics(' + deviceUuid + ', ' + serviceUuid + ', ' + (characteristicUuids ? characteristicUuids.join() : '(all)') + ')');
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

NobleBindings.prototype._onAdvertisementWatcherReceived = function(sender, e) {
  var address = formatBluetoothAddress(e.bluetoothAddress);
  debug('watcher received: ' + address + ' ' + e.advertisement.localName);

  debug('    advertisement type: ' + getEnumName(BluetoothLEAdvertisementType, e.advertisementType));

  var dataSections = rtVectorToArray(e.advertisement.dataSections);
  dataSections.forEach(dataSection => {
    debug('    data section: ' + (getEnumName(BluetoothLEAdvertisementDataTypes, dataSection.dataType) || dataSection.dataType));
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
    case BluetoothLEAdvertisementType.scanResponse:
      connectable = null;
      break;
    default:
      connectable = false;
      break;
  }

  var txPowerLevel = null;
  var dataSections = rtVectorToArray(e.advertisement.dataSections);
  var txPowerDataSection = dataSections.find(
    ds => ds.dataType === BluetoothLEAdvertisementDataTypes.txPowerLevel);
  if (txPowerDataSection) {
    var dataReader = DataReader.fromBuffer(txPowerDataSection.data);
    txPowerLevel = dataReader.readByte();
    if (txPowerLevel >= 128) txPowerLevel -= 256;
    dataReader.close();
  }

  var serviceUuids = rtVectorToArray(e.advertisement.serviceUuids);
  serviceUuids.forEach(serviceUuid => {
    debug('    service UUID: ' + (getEnumName(GattServiceUuids, serviceUuid) || serviceUuid));
  });

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
      address: e.bluetoothAddress,
      formattedAddress: address,
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

NobleBindings.prototype._onAdvertisementWatcherStopped = function(sender, e) {
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

function getEnumName(enumType, value) {
  return Object.keys(enumType).find(enumName =>
    value === enumType[enumName]);
}

module.exports = new NobleBindings();
