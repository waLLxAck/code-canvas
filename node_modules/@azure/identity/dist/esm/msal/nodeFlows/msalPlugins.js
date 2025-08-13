// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { CACHE_CAE_SUFFIX, CACHE_NON_CAE_SUFFIX, DEFAULT_TOKEN_CACHE_NAME, } from "../../constants.js";
/**
 * The current persistence provider, undefined by default.
 * @internal
 */
export let persistenceProvider = undefined;
/**
 * An object that allows setting the persistence provider.
 * @internal
 */
export const msalNodeFlowCacheControl = {
    setPersistence(pluginProvider) {
        persistenceProvider = pluginProvider;
    },
};
/**
 * The current native broker provider, undefined by default.
 * @internal
 */
export let nativeBrokerInfo = undefined;
/**
 * The current VSCode auth record path, undefined by default.
 * @internal
 */
export let vsCodeAuthRecordPath = undefined;
/**
 * The current VSCode broker, undefined by default.
 * @internal
 */
export let vsCodeBrokerInfo = undefined;
export function hasNativeBroker() {
    return nativeBrokerInfo !== undefined;
}
export function hasVSCodePlugin() {
    return vsCodeAuthRecordPath !== undefined && vsCodeBrokerInfo !== undefined;
}
/**
 * An object that allows setting the native broker provider.
 * @internal
 */
export const msalNodeFlowNativeBrokerControl = {
    setNativeBroker(broker) {
        nativeBrokerInfo = {
            broker,
        };
    },
};
/**
 * An object that allows setting the VSCode credential auth record path and broker.
 * @internal
 */
export const msalNodeFlowVSCodeCredentialControl = {
    setVSCodeAuthRecordPath(path) {
        vsCodeAuthRecordPath = path;
    },
    setVSCodeBroker(broker) {
        vsCodeBrokerInfo = {
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
        if (persistenceProvider === undefined) {
            throw new Error([
                "Persistent token caching was requested, but no persistence provider was configured.",
                "You must install the identity-cache-persistence plugin package (`npm install --save @azure/identity-cache-persistence`)",
                "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                "`useIdentityPlugin(cachePersistencePlugin)` before using `tokenCachePersistenceOptions`.",
            ].join(" "));
        }
        const cacheBaseName = options.tokenCachePersistenceOptions.name || DEFAULT_TOKEN_CACHE_NAME;
        config.cache.cachePlugin = persistenceProvider({
            name: `${cacheBaseName}.${CACHE_NON_CAE_SUFFIX}`,
            ...options.tokenCachePersistenceOptions,
        });
        config.cache.cachePluginCae = persistenceProvider({
            name: `${cacheBaseName}.${CACHE_CAE_SUFFIX}`,
            ...options.tokenCachePersistenceOptions,
        });
    }
    if (options.brokerOptions?.enabled) {
        if (options.isVSCodeCredential) {
            if (vsCodeBrokerInfo === undefined) {
                throw new Error([
                    "Visual Studio Code Credential was requested, but no plugin was configured or no authentication record was found.",
                    "You must install the identity-vscode plugin package (`npm install --save @azure/identity-vscode`)",
                    "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                    "`useIdentityPlugin(vsCodePlugin)` before using `enableBroker`.",
                ].join(" "));
            }
            config.broker.nativeBrokerPlugin = vsCodeBrokerInfo.broker;
        }
        else {
            if (nativeBrokerInfo === undefined) {
                throw new Error([
                    "Broker for WAM was requested to be enabled, but no native broker was configured.",
                    "You must install the identity-broker plugin package (`npm install --save @azure/identity-broker`)",
                    "and enable it by importing `useIdentityPlugin` from `@azure/identity` and calling",
                    "`useIdentityPlugin(brokerPlugin)` before using `enableBroker`.",
                ].join(" "));
            }
            config.broker.nativeBrokerPlugin = nativeBrokerInfo.broker;
        }
    }
    return config;
}
/**
 * Wraps generatePluginConfiguration as a writeable property for test stubbing purposes.
 */
export const msalPlugins = {
    generatePluginConfiguration,
};
//# sourceMappingURL=msalPlugins.js.map