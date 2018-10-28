/*!
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import * as assert from 'assert';
import { ApiError } from '@google-cloud/common';
import * as extend from 'extend';
import * as proxyquire from 'proxyquire';
import {util} from '@google-cloud/common-grpc';
import * as pfy from '@google-cloud/promisify';

const fakePaginator = {
  paginator: {
    streamify: function(methodName) {
      return methodName;
    },
  },
};

let promisified = false;
const fakePfy = extend({}, pfy, {
  promisifyAll: function(Class, options) {
    if (Class.name !== 'Instance') {
      return;
    }
    promisified = true;
    assert.deepStrictEqual(options.exclude, ['database']);
  },
});

function FakeDatabase() {
  this.calledWith_ = arguments;
}

function FakeGrpcServiceObject() {
  this.calledWith_ = arguments;
}

describe('Instance', () => {
  let Instance;
  let instance;

  const SPANNER = {
    request: util.noop,
    requestStream: util.noop,
    projectId: 'project-id',
    instances_: new Map(),
  };

  const NAME = 'instance-name';

  before(() => {
    Instance = proxyquire('../src/instance.js', {
      '@google-cloud/common-grpc': {
        ServiceObject: FakeGrpcServiceObject,
      },
      '@google-cloud/promisify': fakePfy,
      '@google-cloud/paginator': fakePaginator,
      './database.js': FakeDatabase,
    });
  });

  beforeEach(() => {
    instance = new Instance(SPANNER, NAME);
  });

  describe('instantiation', () => {
    it('should localize an database map', () => {
      assert(instance.databases_ instanceof Map);
    });

    it('should promisify all the things', () => {
      assert(promisified);
    });

    it('should format the name', () => {
      const formatName_ = Instance.formatName_;
      const formattedName = 'formatted-name';

      Instance.formatName_ = function(projectId, name) {
        Instance.formatName_ = formatName_;

        assert.strictEqual(projectId, SPANNER.projectId);
        assert.strictEqual(name, NAME);

        return formattedName;
      };

      const instance = new Instance(SPANNER, NAME);
      assert(instance.formattedName_, formattedName);
    });

    it('should localize the request function', done => {
      const spannerInstance = extend({}, SPANNER);

      spannerInstance.request = function() {
        assert.strictEqual(this, spannerInstance);
        done();
      };

      const instance = new Instance(spannerInstance, NAME);
      instance.request();
    });

    it('should localize the requestStream function', done => {
      const spannerInstance = extend({}, SPANNER);

      spannerInstance.requestStream = function() {
        assert.strictEqual(this, spannerInstance);
        done();
      };

      const instance = new Instance(spannerInstance, NAME);
      instance.requestStream();
    });

    it('should inherit from ServiceObject', done => {
      const options = {};
      const spannerInstance = extend({}, SPANNER, {
        createInstance: function(name, options_, callback) {
          assert.strictEqual(name, instance.formattedName_);
          assert.strictEqual(options_, options);
          callback(); // done()
        },
      });

      const instance = new Instance(spannerInstance, NAME);
      assert(instance instanceof FakeGrpcServiceObject);

      const calledWith = instance.calledWith_[0];

      assert.strictEqual(calledWith.parent, spannerInstance);
      assert.strictEqual(calledWith.id, NAME);
      assert.deepStrictEqual(calledWith.methods, {create: true});

      calledWith.createMethod(null, options, done);
    });
  });

  describe('formatName_', () => {
    const PATH = 'projects/' + SPANNER.projectId + '/instances/' + NAME;

    it('should return the name if already formatted', () => {
      assert.strictEqual(Instance.formatName_(SPANNER.projectId, PATH), PATH);
    });

    it('should format the name', () => {
      const formattedName = Instance.formatName_(SPANNER.projectId, NAME);
      assert.strictEqual(formattedName, PATH);
    });
  });

  describe('createDatabase', () => {
    const NAME = 'database-name';
    const PATH = 'projects/project-id/databases/' + NAME;

    const OPTIONS = {
      a: 'b',
    };
    const ORIGINAL_OPTIONS = extend({}, OPTIONS);

    it('should throw if a name is not provided', () => {
      assert.throws(() => {
        instance.createDatabase();
      }, /A name is required to create a database\./);
    });

    it('should make the correct default request', done => {
      instance.request = function(config) {
        assert.strictEqual(config.client, 'DatabaseAdminClient');
        assert.strictEqual(config.method, 'createDatabase');
        assert.deepStrictEqual(config.reqOpts, {
          parent: instance.formattedName_,
          createStatement: 'CREATE DATABASE `' + NAME + '`',
        });

        done();
      };

      instance.createDatabase(NAME, assert.ifError);
    });

    it('should accept options', done => {
      instance.request = function(config) {
        assert.deepStrictEqual(OPTIONS, ORIGINAL_OPTIONS);

        const expectedReqOpts = extend(
          {
            parent: instance.formattedName_,
            createStatement: 'CREATE DATABASE `' + NAME + '`',
          },
          OPTIONS
        );

        assert.deepStrictEqual(config.reqOpts, expectedReqOpts);

        done();
      };

      instance.createDatabase(NAME, OPTIONS, assert.ifError);
    });

    it('should only use the name in the createStatement', done => {
      instance.request = function(config) {
        const expectedReqOpts = extend(
          {
            parent: instance.formattedName_,
            createStatement: 'CREATE DATABASE `' + NAME + '`',
          },
          OPTIONS
        );

        assert.deepStrictEqual(config.reqOpts, expectedReqOpts);

        done();
      };

      instance.createDatabase(PATH, OPTIONS, assert.ifError);
    });

    describe('options.poolOptions', () => {
      it('should allow specifying session pool options', done => {
        const poolOptions = {};

        const options = extend({}, OPTIONS, {
          poolOptions: poolOptions,
        });

        instance.request = function(config, callback) {
          assert.strictEqual(config.reqOpts.poolOptions, undefined);
          callback();
        };

        instance.database = function(name, poolOptions_) {
          assert.strictEqual(poolOptions_, poolOptions);
          done();
        };

        instance.createDatabase(PATH, options, assert.ifError);
      });
    });

    describe('options.schema', () => {
      it('should arrify and rename to extraStatements', done => {
        const SCHEMA = 'schema';

        const options = extend({}, OPTIONS, {
          schema: SCHEMA,
        });

        instance.request = function(config) {
          assert.deepStrictEqual(config.reqOpts.extraStatements, [SCHEMA]);
          assert.strictEqual(config.reqOpts.schema, undefined);
          done();
        };

        instance.createDatabase(NAME, options, assert.ifError);
      });
    });

    describe('error', () => {
      const ERROR = new Error('Error.');
      const API_RESPONSE = {};

      beforeEach(() => {
        instance.request = function(config, callback) {
          callback(ERROR, null, API_RESPONSE);
        };
      });

      it('should execute callback with error & API response', done => {
        instance.createDatabase(NAME, OPTIONS, (err, db, op, resp) => {
          assert.strictEqual(err, ERROR);
          assert.strictEqual(op, null);
          assert.strictEqual(resp, API_RESPONSE);
          done();
        });
      });
    });

    describe('success', () => {
      const OPERATION = {};
      const API_RESPONSE = {};

      beforeEach(() => {
        instance.request = function(config, callback) {
          callback(null, OPERATION, API_RESPONSE);
        };
      });

      it('should exec callback with a Database and Operation', done => {
        const fakeDatabaseInstance = {};

        instance.database = function(name) {
          assert.strictEqual(name, NAME);
          return fakeDatabaseInstance;
        };

        instance.createDatabase(NAME, OPTIONS, (err, db, op, resp) => {
          assert.ifError(err);
          assert.strictEqual(db, fakeDatabaseInstance);
          assert.strictEqual(op, OPERATION);
          assert.strictEqual(resp, API_RESPONSE);
          done();
        });
      });
    });
  });

  describe('database', () => {
    const NAME = 'database-name';

    it('should throw if a name is not provided', () => {
      assert.throws(() => {
        instance.database();
      }, /A name is required to access a Database object\./);
    });

    it('should create and cache a Database', () => {
      const cache = instance.databases_;
      const poolOptions = {};

      assert.strictEqual(cache.has(NAME), false);

      const database = instance.database(NAME, poolOptions);

      assert(database instanceof FakeDatabase);
      assert.strictEqual(database.calledWith_[0], instance);
      assert.strictEqual(database.calledWith_[1], NAME);
      assert.strictEqual(database.calledWith_[2], poolOptions);
      assert.strictEqual(database, cache.get(NAME));
    });

    it('should re-use cached objects', () => {
      const cache = instance.databases_;
      const fakeDatabase = {};

      cache.set(NAME, fakeDatabase);

      const database = instance.database(NAME);

      assert.strictEqual(database, fakeDatabase);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      instance.parent = SPANNER;
    });

    it('should close all cached databases', done => {
      let closed = false;

      instance.databases_.set('key', {
        close: function() {
          closed = true;
          return Promise.resolve();
        },
      });

      instance.request = function() {
        assert.strictEqual(closed, true);
        assert.strictEqual(instance.databases_.size, 0);
        done();
      };

      instance.delete(assert.ifError);
    });

    it('should ignore closing errors', done => {
      instance.databases_.set('key', {
        close: function() {
          return Promise.reject(new Error('err'));
        },
      });

      instance.request = function() {
        done();
      };

      instance.delete(assert.ifError);
    });

    it('should make the correct request', done => {
      instance.request = function(config, callback) {
        assert.strictEqual(config.client, 'InstanceAdminClient');
        assert.strictEqual(config.method, 'deleteInstance');
        assert.deepStrictEqual(config.reqOpts, {
          name: instance.formattedName_,
        });
        callback(); // done()
      };

      instance.delete(done);
    });

    it('should remove the Instance from the cache', done => {
      const cache = instance.parent.instances_;

      instance.request = function(config, callback) {
        callback(null);
      };

      cache.set(instance.id, instance);
      assert.strictEqual(cache.get(instance.id), instance);

      instance.delete(err => {
        assert.ifError(err);
        assert.strictEqual(cache.has(instance.id), false);
        done();
      });
    });
  });

  describe('exists', () => {
    it('should return any non-404 like errors', done => {
      const error = {code: 3};

      instance.getMetadata = function(callback) {
        callback(error);
      };

      instance.exists((err, exists) => {
        assert.strictEqual(err, error);
        assert.strictEqual(exists, null);
        done();
      });
    });

    it('should return true if error is absent', done => {
      instance.getMetadata = function(callback) {
        callback(null);
      };

      instance.exists((err, exists) => {
        assert.ifError(err);
        assert.strictEqual(exists, true);
        done();
      });
    });

    it('should return false if not found error if present', done => {
      const error = {code: 5};

      instance.getMetadata = function(callback) {
        callback(error);
      };

      instance.exists((err, exists) => {
        assert.ifError(err);
        assert.strictEqual(exists, false);
        done();
      });
    });
  });

  describe('get', () => {
    it('should call getMetadata', done => {
      const options = {};

      instance.getMetadata = function() {
        done();
      };

      instance.get(options, assert.ifError);
    });

    it('should not require an options object', done => {
      instance.getMetadata = function() {
        done();
      };

      instance.get(assert.ifError);
    });

    describe('autoCreate', () => {
      const error = new ApiError('Error.');
      error.code = 5;

      const OPTIONS = {
        autoCreate: true,
      };

      const OPERATION = {
        listeners: {},
        on: function(eventName, callback) {
          OPERATION.listeners[eventName] = callback;
          return OPERATION;
        },
      };

      beforeEach(() => {
        OPERATION.listeners = {};

        instance.getMetadata = function(callback) {
          callback(error);
        };

        instance.create = function(options, callback) {
          callback(null, null, OPERATION);
        };
      });

      it('should call create', done => {
        instance.create = function(options) {
          assert.strictEqual(options, OPTIONS);
          done();
        };

        instance.get(OPTIONS, assert.ifError);
      });

      it('should return error if create failed', done => {
        const error = new Error('Error.');

        instance.create = function(options, callback) {
          callback(error);
        };

        instance.get(OPTIONS, err => {
          assert.strictEqual(err, error);
          done();
        });
      });

      it('should return operation error', done => {
        const error = new Error('Error.');

        setImmediate(() => {
          OPERATION.listeners['error'](error);
        });

        instance.get(OPTIONS, err => {
          assert.strictEqual(err, error);
          done();
        });
      });

      it('should execute callback if opereation succeeded', done => {
        const metadata = {};

        setImmediate(() => {
          OPERATION.listeners['complete'](metadata);
        });

        instance.get(OPTIONS, (err, instance_, apiResponse) => {
          assert.ifError(err);
          assert.strictEqual(instance_, instance);
          assert.strictEqual(instance.metadata, metadata);
          assert.strictEqual(metadata, apiResponse);
          done();
        });
      });
    });

    it('should not auto create without error code 5', done => {
      const error = new Error('Error.');
      (error as any).code = 'NOT-5';

      const options = {
        autoCreate: true,
      };

      instance.getMetadata = function(callback) {
        callback(error);
      };

      instance.create = function() {
        throw new Error('Should not create.');
      };

      instance.get(options, err => {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should not auto create unless requested', done => {
      const error = new ApiError('Error.');
      error.code = 5;

      instance.getMetadata = function(callback) {
        callback(error);
      };

      instance.create = function() {
        throw new Error('Should not create.');
      };

      instance.get(err => {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should return an error from getMetadata', done => {
      const error = new Error('Error.');

      instance.getMetadata = function(callback) {
        callback(error);
      };

      instance.get(err => {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should return self and API response', done => {
      const apiResponse = {};

      instance.getMetadata = function(callback) {
        callback(null, apiResponse);
      };

      instance.get((err, instance_, apiResponse_) => {
        assert.ifError(err);
        assert.strictEqual(instance_, instance);
        assert.strictEqual(apiResponse_, apiResponse);
        done();
      });
    });
  });

  describe('getDatabases', () => {
    const QUERY = {
      a: 'b',
    };
    const ORIGINAL_QUERY = extend({}, QUERY);

    it('should make the correct request', done => {
      const expectedReqOpts = extend({}, QUERY, {
        parent: instance.formattedName_,
      });

      instance.request = function(config) {
        assert.strictEqual(config.client, 'DatabaseAdminClient');
        assert.strictEqual(config.method, 'listDatabases');
        assert.deepStrictEqual(config.reqOpts, expectedReqOpts);

        assert.notStrictEqual(config.reqOpts, QUERY);
        assert.deepStrictEqual(QUERY, ORIGINAL_QUERY);

        assert.strictEqual(config.gaxOpts, QUERY);

        done();
      };

      instance.getDatabases(QUERY, assert.ifError);
    });

    it('should not require a query', done => {
      instance.request = function(config) {
        assert.deepStrictEqual(config.reqOpts, {
          parent: instance.formattedName_,
        });

        assert.deepStrictEqual(config.gaxOpts, {});

        done();
      };

      instance.getDatabases(assert.ifError);
    });

    describe('error', () => {
      const REQUEST_RESPONSE_ARGS = [new Error('Error.'), null, {}];

      beforeEach(() => {
        instance.request = function(config, callback) {
          callback.apply(null, REQUEST_RESPONSE_ARGS);
        };
      });

      it('should execute callback with original arguments', done => {
        instance.getDatabases(QUERY, function() {
          assert.deepStrictEqual(
            [].slice.call(arguments),
            REQUEST_RESPONSE_ARGS
          );
          done();
        });
      });
    });

    describe('success', () => {
      const DATABASES = [
        {
          name: 'database-name',
        },
      ];

      const REQUEST_RESPONSE_ARGS: any = [null, DATABASES, {}];

      beforeEach(() => {
        instance.request = function(config, callback) {
          callback.apply(null, REQUEST_RESPONSE_ARGS);
        };
      });

      it('should create and return Database objects', done => {
        const fakeDatabaseInstance = {};

        instance.database = function(name) {
          assert.strictEqual(name, DATABASES[0].name);
          return fakeDatabaseInstance;
        };

        instance.getDatabases(QUERY, function(err) {
          assert.ifError(err);

          assert.strictEqual(arguments[0], REQUEST_RESPONSE_ARGS[0]);

          const database = arguments[1].pop();
          assert.strictEqual(database, fakeDatabaseInstance);
          assert.strictEqual(database.metadata, REQUEST_RESPONSE_ARGS[1][0]);

          assert.strictEqual(arguments[2], REQUEST_RESPONSE_ARGS[2]);

          done();
        });
      });
    });
  });

  describe('getMetadata', () => {
    it('should correctly call and return request', () => {
      const requestReturnValue = {};

      function callback() {}

      instance.request = function(config, callback_) {
        assert.strictEqual(config.client, 'InstanceAdminClient');
        assert.strictEqual(config.method, 'getInstance');
        assert.deepStrictEqual(config.reqOpts, {
          name: instance.formattedName_,
        });
        assert.strictEqual(callback_, callback);
        return requestReturnValue;
      };

      const returnValue = instance.getMetadata(callback);
      assert.strictEqual(returnValue, requestReturnValue);
    });
  });

  describe('setMetadata', () => {
    const METADATA = {
      needsToBeSnakeCased: true,
    };
    const ORIGINAL_METADATA = extend({}, METADATA);

    it('should make and return the request', () => {
      const requestReturnValue = {};

      function callback() {}

      instance.request = function(config, callback_) {
        assert.strictEqual(config.client, 'InstanceAdminClient');
        assert.strictEqual(config.method, 'updateInstance');

        const expectedReqOpts = extend({}, METADATA, {
          name: instance.formattedName_,
        });

        assert.deepStrictEqual(config.reqOpts.instance, expectedReqOpts);
        assert.deepStrictEqual(config.reqOpts.fieldMask, {
          paths: ['needs_to_be_snake_cased'],
        });

        assert.deepStrictEqual(METADATA, ORIGINAL_METADATA);

        assert.strictEqual(callback_, callback);

        return requestReturnValue;
      };

      const returnValue = instance.setMetadata(METADATA, callback);
      assert.strictEqual(returnValue, requestReturnValue);
    });

    it('should not require a callback', () => {
      assert.doesNotThrow(() => {
        instance.setMetadata(METADATA);
      });
    });
  });
});
