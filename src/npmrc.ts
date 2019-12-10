import { ServiceLocator } from "./locator";
import * as fs from "fs-extra";
import * as chalk from "chalk";
import * as ini from "ini";
import * as url from "url";
import * as path from "path";
import * as os from "os";
import { getConfig } from "./config";


export type NpmConfig = {
  registries: { [prefix: string]: string };
  tokens: { [domain: string]: string };
  other: { [key: string]: any };
};


const NPMRC_FILENAME = ".npmrc";


export class NpmRC {
  private _npmrc: NpmConfig;

  public constructor() {
    const config = getConfig();
    this._npmrc = this.load(config.mainConfigDir);
  }

  public get defaultRegistry() {
    return this._npmrc.registries.default;
  }

  public getCustomRegistry(namespace: string): string | undefined {
    return this._npmrc.registries[namespace];
  }

  public getCustomRegistries(): string[] {
    return Object.keys(this._npmrc.registries);
  }

  public getTokenForHost(host: string): string | undefined {
    return this._npmrc.tokens[host];
  }

  protected load(dir: string): NpmConfig {
    const loadNpmrc = (filename: string): NpmConfig => {
      let npmrcText = "";
      try {
        npmrcText = fs.readFileSync(filename, { encoding: "utf-8" });
        console.log(`Loaded npm config from ${ filename }`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.log(chalk.red(`Failed to load npm config file ${ filename }: ${ error.message }`));
        }

        return {
          registries: {},
          tokens: {},
          other: {}
        };
      }

      let parsedConfig = ini.parse(npmrcText);
      let npmConfig: NpmConfig = {
        registries: {},
        tokens: {},
        other: {}
      };

      for (let key of Object.keys(parsedConfig)) {
        if (key === "registry") {
          npmConfig.registries.default = parsedConfig[key];
        } else if (key.endsWith(":registry")) {
          npmConfig.registries[key.slice(0, key.indexOf(":"))] = parsedConfig[key];
        } else if (key.endsWith(":_authToken")) {
          let registryUrl = key.slice(0, -":_authToken".length);
          if (registryUrl.startsWith("//")) {
            registryUrl = "http:" + registryUrl;
          }

          let parsedUrl = url.parse(registryUrl);
          if (parsedUrl.host) {
            npmConfig.tokens[parsedUrl.host] = parsedConfig[key];
          }
        } else {
          npmConfig.other[key] = parsedConfig[key];
        }
      }

      return npmConfig;
    };

    let projectConfig = loadNpmrc(path.join(dir, NPMRC_FILENAME));
    let profileConfig = loadNpmrc(path.join(os.homedir(), NPMRC_FILENAME));

    if (!projectConfig.registries.default && !profileConfig.registries.default) {
      throw new Error(`No default NPM registry server found in npm config files. Make sure you have ${ NPMRC_FILENAME } files with explicit registry settings accessible`);
    }

    return {
      registries: Object.assign(profileConfig.registries, projectConfig.registries),
      tokens: Object.assign(profileConfig.tokens, projectConfig.tokens),
      other: Object.assign(profileConfig.tokens, projectConfig.tokens)
    };
  }

  public static init() {
    ServiceLocator.instance.initialize("npmrc", new NpmRC());
  }
}


export function getNpmRc() {
  return ServiceLocator.instance.get<NpmRC>("npmrc");
}
