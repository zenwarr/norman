import {Config, loadConfig, ModuleInfo} from "./config";
import {AppSynchronizer} from "./synchronizer";
import ModuleFetcher from "./fetcher";
import chalk from "chalk";
import * as path from "path";
import {ArgumentParser} from "argparse";
import {LocalNpmServer} from "./server";


export type Arguments = {
  config: string|null;
} & ({
  subCommand: "sync";
  buildDeps: boolean;
  paths: string[];
} | {
  subCommand: "start",
  watch: boolean;
} | {
  subCommand: "list-modules"
});


export class Norman {
  private _fetcher: ModuleFetcher|null = null;
  private _server: LocalNpmServer|null = null;
  private _appSynchronizer: AppSynchronizer|null = null;
  private _config: Config|null = null;
  private _args: Arguments|null = null;


  get args(): Arguments {
    return this._args!;
  }


  get moduleFetcher(): ModuleFetcher {
    if (!this._fetcher) {
      throw new Error("Fetcher instance is not yet initialized");
    }
    return this._fetcher;
  }


  get appSynchronizer(): AppSynchronizer {
    if (!this._appSynchronizer) {
      throw new Error("App synhronizer instance is not yet initialized");
    }
    return this._appSynchronizer;
  }


  get localNpmServer(): LocalNpmServer {
    if (!this._server) {
      throw new Error("Local npm server is not yet initialized");
    }
    return this._server;
  }


  get config(): Config {
    if (!this._config) {
      throw new Error("Config is not yet loaded");
    }
    return this._config;
  }


  getModuleInfo(moduleName: string): ModuleInfo|null {
    return this.config.modules.find(module => module.npmName.name === moduleName || module.name === moduleName) || null;
  }


  async start() {
    let argparser = new ArgumentParser({
      addHelp: true
    });
    argparser.addArgument([ "--config", "-c" ], {
      help: "Path to config file or a directory containing config file named .norman.json"
    });

    let subparsers = argparser.addSubparsers({
      title: "Subcommand",
      dest: "subCommand"
    });

    let syncParser = subparsers.addParser("sync", {
      help: "Synchronizes a local module"
    });
    syncParser.addArgument("--build-deps", {
      help: "Builds dependent local modules before synchronization",
      action: "storeTrue",
      defaultValue: false,
      dest: "buildDeps"
    });
    syncParser.addArgument("paths", {
      help: "Path to module to synchronize",
      nargs: "*"
    });

    let initParser = subparsers.addParser("start", {
      help: "Fetches and initializes all local modules"
    });
    initParser.addArgument([ "--watch", "-w" ], {
      help: "Watch for changes in local modules and automatically synchronize dependent modules",
      action: "storeTrue",
      defaultValue: false
    });

    let listModulesParser = subparsers.addParser("list-modules", {
      help: "List all modules loaded from the configuration files"
    });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (args.config) {
      if (!path.isAbsolute(args.config)) {
        args.config = path.resolve(process.cwd(), args.config);
      }
    }

    if (args.subCommand === "sync" && args.paths) {
      for (let q = 0; q < args.paths.length; ++q) {
        if (!path.isAbsolute(args.paths[q])) {
          args.paths[q] = path.resolve(process.cwd(), args.paths[q]);
        }
      }
    }

    this._config = loadConfig(args.config);

    if (args.subCommand === "list-modules") {
      console.log(chalk.green("-- BEGIN MODULES LIST"));
      for (let module of this.config.modules) {
        console.log(`${module.npmName.name}: ${module.path}`);
      }
      console.log(chalk.green("-- END MODULES LIST"));

      process.exit(0);
      return;
    }

    this._server = new LocalNpmServer(this);
    this._fetcher = new ModuleFetcher(this);

    await this._server.start();
    await this._fetcher.start();

    if (args.subCommand === "start") {
      if (args.watch) {
        this._appSynchronizer = new AppSynchronizer(this);
        await this._appSynchronizer.start();
      }
    } else if (args.subCommand === "sync") {
      this._appSynchronizer = new AppSynchronizer(this);

      let localModules = args.paths.map((argPath): ModuleInfo => {
        if (!argPath.endsWith("/")) {
          argPath += "/";
        }

        let localModule = this.config.modules.find(module => {
          let modulePath = module.path;
          if (!modulePath.endsWith("/")) {
            modulePath += "/";
          }

          return path.normalize(modulePath) === path.normalize(argPath);
        });

        if (!localModule) {
          console.log(chalk.red(`No local module found at ${argPath}`));
          process.exit(-1);
          throw new Error();
        }

        return localModule;
      });

      for (let localModule of localModules) {
        await this.appSynchronizer.syncModule(localModule);
      }
    }

    await this._server.stop();
  }
}


export function start(): void {
  let norman = new Norman();

  norman.start().then(() => {

  }, (error: Error) => {
    console.log(chalk.red(`Error: ${error.message}`));
    console.error(error);
  });
}
