"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultAzureCredential = exports.UnavailableDefaultCredential = void 0;
const chainedTokenCredential_js_1 = require("./chainedTokenCredential.js");
const logging_js_1 = require("../util/logging.js");
const defaultAzureCredentialFunctions_js_1 = require("./defaultAzureCredentialFunctions.js");
const logger = (0, logging_js_1.credentialLogger)("DefaultAzureCredential");
/**
 * A no-op credential that logs the reason it was skipped if getToken is called.
 * @internal
 */
class UnavailableDefaultCredential {
    credentialUnavailableErrorMessage;
    credentialName;
    constructor(credentialName, message) {
        this.credentialName = credentialName;
        this.credentialUnavailableErrorMessage = message;
    }
    getToken() {
        logger.getToken.info(`Skipping ${this.credentialName}, reason: ${this.credentialUnavailableErrorMessage}`);
        return Promise.resolve(null);
    }
}
exports.UnavailableDefaultCredential = UnavailableDefaultCredential;
/**
 * Provides a default {@link ChainedTokenCredential} configuration that works for most
 * applications that use Azure SDK client libraries. For more information, see
 * [DefaultAzureCredential overview](https://aka.ms/azsdk/js/identity/credential-chains#use-defaultazurecredential-for-flexibility).
 *
 * The following credential types will be tried, in order:
 *
 * - {@link EnvironmentCredential}
 * - {@link WorkloadIdentityCredential}
 * - {@link ManagedIdentityCredential}
 * - {@link VisualStudioCodeCredential}
 * - {@link AzureCliCredential}
 * - {@link AzurePowerShellCredential}
 * - {@link AzureDeveloperCliCredential}
 *
 * Consult the documentation of these credential types for more information
 * on how they attempt authentication.
 *
 * Selecting credentials
 *
 * Set environment variable AZURE_TOKEN_CREDENTIALS to select a subset of the credential chain.
 * DefaultAzureCredential will try only the specified credential(s), but its other behavior remains the same.
 * Valid values for AZURE_TOKEN_CREDENTIALS are the name of any single type in the above chain, for example
 * "EnvironmentCredential" or "AzureCliCredential", and these special values:
 *
 *   - "dev": try [VisualStudioCodeCredential], [AzureCliCredential], [AzurePowerShellCredential] and [AzureDeveloperCliCredential], in that order
 *   - "prod": try [EnvironmentCredential], [WorkloadIdentityCredential], and [ManagedIdentityCredential], in that order
 *
 */
class DefaultAzureCredential extends chainedTokenCredential_js_1.ChainedTokenCredential {
    constructor(options) {
        // If AZURE_TOKEN_CREDENTIALS is not set, use the default credential chain.
        const azureTokenCredentials = process.env.AZURE_TOKEN_CREDENTIALS
            ? process.env.AZURE_TOKEN_CREDENTIALS.trim().toLowerCase()
            : undefined;
        const devCredentialFunctions = [
            defaultAzureCredentialFunctions_js_1.createDefaultVisualStudioCodeCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultAzureCliCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultAzurePowershellCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultAzureDeveloperCliCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultBrokerCredential,
        ];
        const prodCredentialFunctions = [
            defaultAzureCredentialFunctions_js_1.createDefaultEnvironmentCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultWorkloadIdentityCredential,
            defaultAzureCredentialFunctions_js_1.createDefaultManagedIdentityCredential,
        ];
        let credentialFunctions = [];
        const validCredentialNames = "EnvironmentCredential, WorkloadIdentityCredential, ManagedIdentityCredential, VisualStudioCodeCredential, AzureCliCredential, AzurePowerShellCredential, AzureDeveloperCliCredential";
        // If AZURE_TOKEN_CREDENTIALS is set, use it to determine which credentials to use.
        // The value of AZURE_TOKEN_CREDENTIALS should be either "dev" or "prod" or any one of these credentials - {validCredentialNames}.
        if (azureTokenCredentials) {
            switch (azureTokenCredentials) {
                case "dev":
                    credentialFunctions = devCredentialFunctions;
                    break;
                case "prod":
                    credentialFunctions = prodCredentialFunctions;
                    break;
                case "environmentcredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultEnvironmentCredential];
                    break;
                case "workloadidentitycredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultWorkloadIdentityCredential];
                    break;
                case "managedidentitycredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultManagedIdentityCredential];
                    break;
                case "visualstudiocodecredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultVisualStudioCodeCredential];
                    break;
                case "azureclicredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultAzureCliCredential];
                    break;
                case "azurepowershellcredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultAzurePowershellCredential];
                    break;
                case "azuredeveloperclicredential":
                    credentialFunctions = [defaultAzureCredentialFunctions_js_1.createDefaultAzureDeveloperCliCredential];
                    break;
                default: {
                    // If AZURE_TOKEN_CREDENTIALS is set to an unsupported value, throw an error.
                    // This will prevent the creation of the DefaultAzureCredential.
                    const errorMessage = `Invalid value for AZURE_TOKEN_CREDENTIALS = ${process.env.AZURE_TOKEN_CREDENTIALS}. Valid values are 'prod' or 'dev' or any of these credentials - ${validCredentialNames}.`;
                    logger.warning(errorMessage);
                    throw new Error(errorMessage);
                }
            }
        }
        else {
            // If AZURE_TOKEN_CREDENTIALS is not set, use the default credential chain.
            credentialFunctions = [...prodCredentialFunctions, ...devCredentialFunctions];
        }
        // Errors from individual credentials should not be thrown in the DefaultAzureCredential constructor, instead throwing on getToken() which is handled by ChainedTokenCredential.
        // When adding new credentials to the default chain, consider:
        // 1. Making the constructor parameters required and explicit
        // 2. Validating any required parameters in the factory function
        // 3. Returning a UnavailableDefaultCredential from the factory function if a credential is unavailable for any reason
        const credentials = credentialFunctions.map((createCredentialFn) => {
            try {
                return createCredentialFn(options);
            }
            catch (err) {
                logger.warning(`Skipped ${createCredentialFn.name} because of an error creating the credential: ${err}`);
                return new UnavailableDefaultCredential(createCredentialFn.name, err.message);
            }
        });
        super(...credentials);
    }
}
exports.DefaultAzureCredential = DefaultAzureCredential;
//# sourceMappingURL=defaultAzureCredential.js.map