import {Config, loadConfig, ModuleInfo} from "./config";
import {AppSynchronizer} from "./synchronizer";
import ModuleFetcher from "./fetcher";
import chalk from "chalk";
import * as path from "path";
import {ArgumentParser} from "argparse";
import {LocalNpmServer, ModuleInfoWithDeps} from "./server";
import * as utils from "./utils";
import {ModuleStateManager} from "./module-state-manager";


export type Arguments = {
  config: string|null;
} & ({
  subCommand: "sync";
  buildDeps: boolean;
  path: string;
} | {
  subCommand: "start",
  watch: boolean;
} | {
  subCommand: "list-modules"
} | {
  subCommand: "dependency-tree"
} | {
  subCommand: "clean",
  cleanWhat: string
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

    let syncParser = subparsers.addParser("sync", { help: "Synchronizes a local module" });
    syncParser.addArgument("--build-deps", {
      help: "Builds dependent local modules before synchronization",
      action: "storeTrue",
      defaultValue: false,
      dest: "buildDeps"
    });
    syncParser.addArgument("path", { help: "Path to module to synchronize" });

    let initParser = subparsers.addParser("start", { help: "Fetches and initializes all local modules" });
    initParser.addArgument([ "--watch", "-w" ], {
      help: "Watch for changes in local modules and automatically synchronize dependent modules",
      action: "storeTrue",
      defaultValue: false
    });

    subparsers.addParser("list-modules", { help: "List all modules loaded from the configuration files" });
    subparsers.addParser("dependency-tree", { help: "Show local modules dependency tree" });

    let cleanParser = subparsers.addParser("clean");
    let cleanSubparsers = cleanParser.addSubparsers({
      title: "What to clean",
      dest: "cleanWhat"
    });
    cleanSubparsers.addParser("cache", { help: "Clean local NPM server cache" });
    cleanSubparsers.addParser("state", { help: "Clean saved local modules state" });
    cleanSubparsers.addParser("all", { help: "Clean local NPM server cache, saved local modules cache and temp files" });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (args.config) {
      if (!path.isAbsolute(args.config)) {
        args.config = path.resolve(process.cwd(), args.config);
      }
    }

    if (args.subCommand === "sync" && args.path) {
      if (!path.isAbsolute(args.path)) {
        args.path = path.resolve(process.cwd(), args.path);
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
    } else if (args.subCommand === "dependency-tree") {
      console.log(chalk.green("-- BEGIN DEPENDENCY TREE"));

      let tree = this.getDependencyTree(this.config.modules);

      let isFirst = true;

      const printTree = (leaf: ModuleInfo, level: number = 0) => {
        let prefix = level === 0 ? (isFirst ? '- ' : '\n- ') : ' '.repeat(level * 2 + 2);
        console.log(`${prefix}${leaf.npmName.name}`);

        let root = tree.find(treeLeaf => treeLeaf.module.npmName.name === leaf.npmName.name);
        if (root) {
          for (let dep of root.dependencies) {
            printTree(dep, level + 1);
          }
        }
      };

      for (let treeRoot of tree) {
        printTree(treeRoot.module);
        isFirst = false;
      }

      console.log(chalk.green("-- END DEPENDENCY TREE"));

      console.log(chalk.green(`\n-- BEGIN WALK ORDER`));

      await this.walkDependencyTree(this.config.modules, async module => {
        console.log(module.npmName.name);
      });

      console.log(chalk.green('-- END WALK ORDER'));

      process.exit(0);
      return;
    } else if (args.subCommand === "clean") {
      if (args.cleanWhat === "cache" || args.cleanWhat === "all") {
        console.log(chalk.green(`Cleaning local npm server cache`));

        LocalNpmServer.cleanCache();

        console.log(chalk.green('DONE'));
      }

      if (args.cleanWhat === "state" || args.cleanWhat === "all") {
        console.log(chalk.green(`Cleaning stored modules state`));

        ModuleStateManager.cleanState();

        console.log(chalk.green('DONE'));
      }

      if (args.cleanWhat === "all") {
        console.log(chalk.green(`Cleaning temp files`));

        LocalNpmServer.cleanTemp();

        console.log(chalk.green('DONE'));
      }

      process.exit(0);
      return;
    }

    this._server = new LocalNpmServer(this);
    this._fetcher = new ModuleFetcher(this);
    this._appSynchronizer = new AppSynchronizer(this);

    await this._server.start();
    await this._fetcher.start();

    if (args.subCommand === "start") {
      await this.moduleFetcher.installModules();

      if (args.watch) {
        await this._appSynchronizer.start();
      }
    } else if (args.subCommand === "sync") {
      let argPath = args.path;
      let localModule = this.config.modules.find(module => {
        return module.npmName.name === argPath;
      });

      if (!localModule) {
        if (!argPath.endsWith("/")) {
          argPath += "/";
        }

        localModule = this.config.modules.find(module => {
          let modulePath = module.path;
          if (!modulePath.endsWith("/")) {
            modulePath += "/";
          }

          return path.normalize(modulePath) === path.normalize(argPath);
        });

        if (!localModule) {
          console.log(chalk.red(`No local module found with name "${argPath}" or at "${argPath}"`));
          process.exit(-1);
          throw new Error();
        }
      }

      await this.appSynchronizer.syncModule(localModule);
    }

    await this._server.stop();
  }


  getDependencyTree(modules: ModuleInfo[]): ModuleInfoWithDeps[] {
    return modules.map(module => {
      let subDeps = utils.getPackageDeps(module.path).map(moduleName => this.getModuleInfo(moduleName)).filter(dep => dep != null);

      return {
        module,
        dependencies: subDeps as ModuleInfo[]
      }
    });
  }

  async walkDependencyTree(modules: ModuleInfo[], walker: (module: ModuleInfo) => Promise<void>): Promise<void> {
    let tree = this.getDependencyTree(modules);

    const walkedModules: string[] = [];

    const markWalked = (module: ModuleInfo) => {
      if (walkedModules.indexOf(module.npmName.name) < 0) {
        walkedModules.push(module.npmName.name);
      }
    };

    const isAlreadyWalked = (module: ModuleInfo) => {
      return walkedModules.indexOf(module.npmName.name) >= 0;
    };

    const walkModule = async (module: ModuleInfoWithDeps, parents: string[]) => {
      if (isAlreadyWalked(module.module)) {
        return;
      }

      for (let dep of module.dependencies) {
        if (parents.indexOf(dep.npmName.name) >= 0) {
          // recursive dep
          throw new Error(`Recursive dependency: ${dep.npmName.name}, required by ${parents.join(" -> ")}`);
        }

        let depWithDeps = tree.find(module => module.module.npmName.name === dep.npmName.name);
        if (depWithDeps) {
          await walkModule(depWithDeps, parents.concat([ module.module.npmName.name ]));
        }
      }

      await walker(module.module);

      markWalked(module.module);
    };

    for (let module of tree) {
      await walkModule(module, []);
    }
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
