import * as child_process from "child_process";
import * as chalk from "chalk";
import * as path from "path";
import * as fs from "fs-extra";
import { ServiceLocator } from "./locator";
import { Config, getConfig, RegistryServerType } from "./config/config";
import { getNpmRc } from "./npmrc";


function getUplinkNameFromUrl(url: string) {
  return url.replace(/[/]+$/, "").replace(/[:/.]/g, "_");
}


export class NpmRegistry {
  private proc: child_process.ChildProcess | undefined;
  private closeHasIntention = false;


  public get address(): string {
    let config = getConfig();
    if (config.registryServerType === RegistryServerType.ManagedLocal) {
      return `http://localhost:${ config.managedRegistryPort }/`;
    } else {
      return config.remoteRegistryUrl!;
    }
  }


  private getStoragePath(): string {
    let storagePath = path.join(Config.getConfigDir(), "verdaccio-storage");
    fs.mkdirpSync(storagePath);
    return storagePath;
  }


  private buildConfig(): string {
    let config = { ...require("./verdaccio/config-template.json") };
    config.storage = this.getStoragePath();

    let uplinkDomains = new Set<string>();

    let npmrc = getNpmRc();
    let registries = npmrc.getCustomRegistries();
    for (let prefix of registries) {
      let domain = npmrc.getCustomRegistry(prefix);
      if (!domain) {
        throw new Error(`No domain found for custom registry ${ prefix } in .npmrc`);
      }

      let uplink = getUplinkNameFromUrl(domain);
      uplinkDomains.add(domain);

      if (prefix === "default") {
        config.packages["**"].proxy = [ uplink ];
      } else {
        let pattern = `${ prefix }/*`;
        if (pattern in config.packages) {
          config.packages[pattern].proxy.push(uplink);
        } else {
          config.packages[pattern] = {
            access: "$all",
            publish: "$all",
            unpublish: "$all",
            proxy: [
              uplink
            ]
          };
        }
      }
    }

    for (let uplinkDomain of uplinkDomains.entries()) {
      let url = uplinkDomain[0];
      let uplink = getUplinkNameFromUrl(url);

      let token = npmrc.getTokenForRegistry(url);
      if (!token) {
        throw new Error(`Token for registry "${ url }" not found in .nprmc`);
      }

      config.uplinks[uplink] = {
        url,
        auth: {
          type: "bearer",
          token
        }
      };
    }

    let configDir = Config.getConfigDir();
    fs.mkdirpSync(configDir);

    let configFilePath = path.join(configDir, "verdaccio.json");

    fs.writeJSONSync(configFilePath, config, {
      spaces: 2
    });

    return configFilePath;
  }


  public async start(): Promise<void> {
    let config = getConfig();
    if (config.registryServerType === RegistryServerType.Remote) {
      return;
    } else if (config.registryServerType !== RegistryServerType.ManagedLocal) {
      throw new Error("Unsupported serverType: " + config.registryServerType);
    }

    return new Promise<void>((resolve, reject) => {
      let verdaccioPath = path.join(__dirname, "..", "node_modules", ".bin", "verdaccio");
      let verdaccioConfigPath = this.buildConfig();

      let port = config.managedRegistryPort!;
      this.proc = child_process.spawn("node", [ verdaccioPath, "-c", verdaccioConfigPath, "-l", "" + port ], {
        stdio: "pipe",
        stderr: "pipe"
      } as any);

      if (this.proc.stdout) {
        this.proc.stdout.on("data", (data: Buffer) => {
          let line = data.toString("utf-8");
          if (line.includes("http address")) {
            console.log(`Local npm registry server listening on port ${ port }`);
            resolve();
          }
        });
      }

      this.proc.on("close", code => {
        if (!this.closeHasIntention) {
          console.error(chalk.red(`Verdaccio server closed: ${ code }`));
          process.exit(-1);
        }
      });

      this.proc.on("error", error => {
        console.error(chalk.red(`Verdaccio server error: ${ error.message }`));
        process.exit(-1);
      });
    });
  }


  public stop(): void {
    if (!this.proc) {
      return;
    }

    this.closeHasIntention = true;
    this.proc.kill();
  }


  public static async init() {
    const registry = new NpmRegistry();
    await registry.start();
    ServiceLocator.instance.initialize("registry", registry);
  }
}


export function getRegistry() {
  return ServiceLocator.instance.get<NpmRegistry>("registry");
}
