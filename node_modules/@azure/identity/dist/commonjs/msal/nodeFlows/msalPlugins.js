"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.msalPlugins = exports.msalNodeFlowVSCodeCredentialControl = exports.msalNodeFlowNativeBrokerControl = exports.vsCodeBrokerInfo = exports.vsCodeAuthRecordPath = exports.nativeBrokerInfo = exports.msalNodeFlowCacheControl = exports.persistenceProvider = void 0;
exports.hasNativeBroker = hasNativeBroker;
exports.hasVSCodePlugin = hasVSCodePlugin;
const constants_js_1 = require("../../constants.js");
/**
 * The current persistence provider, undefined by default.
 * @internal
 */
exports.persistenceProvider = undefined;
/**
 * An object that allows setting the persistence provider.
 * @internal
 */
exports.msalNodeFlowCacheControl = {
    setPersistence(pluginProvider) {
        exports.persistenceProvider = pluginProvider;
    },
};
/**
 * The current native broker provider, undefined by default.
 * @internal
 */
exports.nativeBrokerInfo = undefined;
/**
 * The current VSCode auth record path, undefined by default.
 * @internal
 */
exports.vsCodeAuthRecordPath = undefined;
/**
 * The current VSCode broker, undefined by default.
 * @internal
 */
exports.vsCodeBrokerInfo = undefined;
function hasNativeBroker() {
    return exports.nativeBrokerInfo !== undefined;
}
function hasVSCodePlugin() {
    return exports.vsCodeAuthRecordPath !== undefined && exports.vsCodeBrokerInfo !== undefined;
}
/**
 * An object that allows setting the native broker provider.
 * @internal
 */
exports.msalNodeFlowNativeBrokerControl = {
    setNativeBroker(broker) {
        exports.nativeBrokerInfo = {
            broker,
        };
    },
};
/**
 * An object that allows setting the VSCode credential auth record path and broker.
 * @internal
 */
exports.msalNodeFlowVSCodeCredentialControl = {
    setVSCodeAuthRecordPath(path) {
        exports.vsCodeAuthRecordPath = path;
    },
    setVSCodeBroker(broker) {
        exports.vsCodeBrokerInfo = {
            broker,
        };
    },
};
/**
 * Configures plugins, validating that required plugins are available and enabled.
 *
 * Does not create the plugins themselves, but rather returns the configuration that will be used to create them.
 *
 * @param options - options for creating the MSAL client
 * @returns plugin configuration
 */
function generatePluginConfiguration(options) {
    const config = {
        cache: {},
        broker: {
            ...options.brokerOptions,
            isEnabled: options.brokerOptions?.enabled ?? false,
            enableMsaPassthrough: options.brokerOptions?.legacyEnableMsaPassthrough ?? false,
        },
    };
    if (options.tokenCachePersistenceOptions?.enabled) {
        if (exports.persistenceProvider === undefined) {
            throw new Error([
                "Persistent token caching was requested, but no persistence provider was configured.",
                "You must install the identity-cache-persistence plugin package (`npm install --save @azure/identity-cache-persistence`)",
                "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                "`useIdentityPlugin(cachePersistencePlugin)` before using `tokenCachePersistenceOptions`.",
            ].join(" "));
        }
        const cacheBaseName = options.tokenCachePersistenceOptions.name || constants_js_1.DEFAULT_TOKEN_CACHE_NAME;
        config.cache.cachePlugin = (0, exports.persistenceProvider)({
            name: `${cacheBaseName}.${constants_js_1.CACHE_NON_CAE_SUFFIX}`,
            ...options.tokenCachePersistenceOptions,
        });
        config.cache.cachePluginCae = (0, exports.persistenceProvider)({
            name: `${cacheBaseName}.${constants_js_1.CACHE_CAE_SUFFIX}`,
            ...options.tokenCachePersistenceOptions,
        });
    }
    if (options.brokerOptions?.enabled) {
        if (options.isVSCodeCredential) {
            if (exports.vsCodeBrokerInfo === undefined) {
                throw new Error([
                    "Visual Studio Code Credential was requested, but no plugin was configured or no authentication record was found.",
                    "You must install the identity-vscode plugin package (`npm install --save @azure/identity-vscode`)",
                    "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                    "`useIdentityPlugin(vsCodePlugin)` before using `enableBroker`.",
                ].join(" "));
            }
            config.broker.nativeBrokerPlugin = exports.vsCodeBrokerInfo.broker;
        }
        else {
            if (exports.nativeBrokerInfo === undefined) {
                throw new Error([
                    "Broker for WAM was requested to be enabled, but no native broker was configured.",
                    "You must install the identity-broker plugin package (`npm install --save @azure/identity-broker`)",
                    "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                    "`useIdentityPlugin(brokerPlugin)` before using `enableBroker`.",
                ].join(" "));
            }
            config.broker.nativeBrokerPlugin = exports.nativeBrokerInfo.broker;
        }
    }
    return config;
}
/**
 * Wraps generatePluginConfiguration as a writeable property for test stubbing purposes.
 */
exports.msalPlugins = {
    generatePluginConfiguration,
};
//# sourceMappingURL=msalPlugins.js.map