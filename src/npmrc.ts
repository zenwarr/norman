import { ServiceLocator } from "./locator";
import * as fs from "fs-extra";
import * as chalk from "chalk";
import * as ini from "ini";
import * as url from "url";
import * as path from "path";
import * as os from "os";
import { getProjectIfExists } from "./project";


export type NpmConfig = {
  registries: { [prefix: string]: string };
  tokens: { [domain: string]: string };
  other: { [key: string]: any };
};


const NPMRC_FILENAME = ".npmrc";
const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";


function emptyNpmConfig() {
  return {
    registries: {},
    tokens: {},
    other: {}
  };
}


export class NpmRC {
  private _npmrc: NpmConfig;


  public constructor() {
    const config = getProjectIfExists();
    this._npmrc = this.load(config ? config.mainProjectDir : undefined);
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


  public getTokenForRegistry(registry: string): string {
    let hostname = new url.URL(registry).hostname;
    return this._npmrc.tokens[hostname];
  }


  protected load(dir?: string): NpmConfig {
    const loadNpmrc = (filename: string): NpmConfig => {
      let npmrcText = "";
      try {
        npmrcText = fs.readFileSync(filename, { encoding: "utf-8" });
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

    let projectConfig: NpmConfig;
    if (dir) {
      projectConfig = loadNpmrc(path.join(dir, NPMRC_FILENAME));
    } else {
      projectConfig = emptyNpmConfig();
    }

    let profileConfig = loadNpmrc(path.join(os.homedir(), NPMRC_FILENAME));

    if (!projectConfig.registries.default && !profileConfig.registries.default) {
      profileConfig.registries.default = DEFAULT_NPM_REGISTRY;
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
