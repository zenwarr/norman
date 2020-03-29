import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { ServiceLocator } from "../locator";


export enum RegistryServerType {
  ManagedLocal = "managed-local",
  Remote = "remote"
}


const DEFAULT_CONFIG = {
  registryServerType: RegistryServerType.ManagedLocal,
  managedRegistryPort: 5679
};


export class Config {
  private constructor(configInput: unknown) {
    if (typeof configInput !== "object" || configInput == null) {
      throw new Error("Invalid config file contents: should be object");
    }

    let registryServerType = (configInput as any).registryServerType;
    if (registryServerType !== RegistryServerType.ManagedLocal && registryServerType !== RegistryServerType.Remote) {
      throw new Error(`Invalid config file: registryServerType should be one of 'managed-local' or 'remote', got: "${ registryServerType }"`);
    }

    this.registryServerType = registryServerType;

    let port = (configInput as any).managedRegistryPort;
    if (registryServerType === RegistryServerType.Remote) {
      // port is not required when using remote server
      if (port != null && (!port || typeof port !== "number")) {
        throw new Error("Invalid config file: managedRegistryPort should be a non-zero number");
      }
    } else {
      // port is required when using managed local server
      if (!port || typeof port !== "number") {
        throw new Error("Invalid config file: managedRegistryPort should be a non-zero number");
      }
    }

    this.managedRegistryPort = port;

    if (registryServerType === RegistryServerType.Remote) {
      let remoteRegistryUrl = (configInput as any).remoteRegistryUrl;
      if (!remoteRegistryUrl || typeof remoteRegistryUrl !== "string") {
        throw new Error("Invalid config file: remoteRegistryUrl should be a non-empty string");
      }

      this.remoteRegistryUrl = remoteRegistryUrl;
    }
  }

  public readonly registryServerType: RegistryServerType;
  public readonly managedRegistryPort: number | undefined;
  public readonly remoteRegistryUrl: string | undefined;

  private static getConfigPath(): string {
    return path.join(this.getConfigDir(), "config.json");
  }

  private static createDefaultConfig(configFilePath: string) {
    fs.mkdirpSync(path.dirname(configFilePath));
    fs.writeJSONSync(configFilePath, DEFAULT_CONFIG, {
      spaces: 2
    });
  }

  public static init() {
    let configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) {
      this.createDefaultConfig(configPath);
    }

    let configInput = fs.readJSONSync(configPath, { encoding: "utf-8" });
    let config = new Config(configInput);

    ServiceLocator.instance.initialize("config", config);
  }

  public static getConfigDir(): string {
    return path.join(os.homedir(), ".config", "norman");
  }
}


export function getConfig() {
  return ServiceLocator.instance.get<Config>("config");
}
