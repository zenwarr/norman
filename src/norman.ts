import { ModuleSynchronizer } from "./module-synchronizer";
import ModuleFetcher from "./fetcher";
import chalk from "chalk";
import * as path from "path";
import { ArgumentParser } from "argparse";
import { LocalNpmServer } from "./server";
import { ModuleStateManager } from "./module-state-manager";
import { Config } from "./config";
import { ModuleInfo } from "./module-info";
import { ModulePackager } from "./module-packager";
import { ModulesFeeder } from "./module-watcher";
import { FileTransformerPlugin, SourceMapPlugin } from "./plugin";


export type Arguments = {
  config: string | null;
  ignoreMissingIncludedModules: boolean;
} & ({
  subCommand: "sync";
  buildDeps: boolean;
  path: string;
  watch: string;
} | {
  subCommand: "sync-all";
  buildDeps: boolean;
} | {
  subCommand: "fetch";
  noInstall: boolean;
} | {
  subCommand: "list-modules";
} | {
  subCommand: "dependency-tree";
} | {
  subCommand: "clean";
  cleanWhat: string;
} | {
  subCommand: "outdated";
  upgrade: boolean;
  hard: boolean;
  withIncluded: boolean;
});


export class Norman {
  private _fetcher: ModuleFetcher | null = null;
  private _server: LocalNpmServer | null = null;
  private _config: Config | null = null;
  private _args!: Arguments;
  private _plugins: FileTransformerPlugin[] = [ new SourceMapPlugin() ];


  public get args(): Arguments {
    return this._args;
  }


  public get plugins() {
    return this._plugins;
  }


  public get moduleFetcher(): ModuleFetcher {
    if (!this._fetcher) {
      throw new Error("Fetcher instance is not yet initialized");
    }
    return this._fetcher;
  }


  public get localNpmServer(): LocalNpmServer {
    if (!this._server) {
      throw new Error("Local npm server is not yet initialized");
    }
    return this._server;
  }


  public get config(): Config {
    if (!this._config) {
      throw new Error("Config is not yet loaded");
    }
    return this._config;
  }


  protected parseArgs() {
    let argparser = new ArgumentParser({
      addHelp: true
    });
    argparser.addArgument([ "--config", "-c" ], {
      help: "Path to config file or a directory containing config file named .norman.json"
    });
    argparser.addArgument("--ignore-missing-included-modules", {
      help: "Do not raise an error if a path specified in 'includeModules' is invalid",
      action: "storeTrue",
      defaultValue: false,
      dest: "ignoreMissingIncludedModules"
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
    syncParser.addArgument("--watch", {
      help: "Watch for changes in dependent modules and sync immediately",
      action: "storeTrue",
      defaultValue: false,
      dest: "watch"
    });
    syncParser.addArgument("path", { help: "Path to module to synchronize" });

    let syncAllParser = subparsers.addParser("sync-all", { help: "Synchronize all local modules" });
    syncAllParser.addArgument("--build-deps", {
      help: "Build dependent local modules before synchronization",
      action: "storeTrue",
      defaultValue: false,
      dest: "buildDeps"
    });

    let fetchParser = subparsers.addParser("fetch", { help: "Fetches and initializes all local modules" });
    fetchParser.addArgument("--no-install", {
      help: "Do not run install steps or build modules after fetching",
      action: "storeTrue",
      defaultValue: false,
      dest: "noInstall"
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

    let outdatedParser = subparsers.addParser("outdated", { help: "Shows and helps to update outdated dependencies" });
    outdatedParser.addArgument("--upgrade", {
      help: "Automatically update all dependencies to wanted versions",
      action: "storeTrue",
      defaultValue: false,
      dest: "upgrade"
    });
    outdatedParser.addArgument("--hard", {
      help: "Automatically update all dependencies to the latest versions (can break things)",
      action: "storeTrue",
      defaultValue: false,
      dest: "hard"
    });
    outdatedParser.addArgument("--with-included", {
      help: "Analyze and upgrade dependencies of modules included by 'includeModules' too",
      action: "storeTrue",
      defaultValue: false,
      dest: "withIncluded"
    });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (args.config) {
      if (!path.isAbsolute(args.config)) {
        args.config = path.resolve(process.cwd(), args.config);
      }
    }
  }


  protected async handleCleanCommand(): Promise<void> {
    let args = this.args;

    if (args.subCommand !== "clean") {
      return;
    }

    if (args.cleanWhat === "cache" || args.cleanWhat === "all") {
      console.log(chalk.green("Cleaning local npm server cache"));

      LocalNpmServer.cleanCache();
    }

    if (args.cleanWhat === "state" || args.cleanWhat === "all") {
      console.log(chalk.green("Cleaning stored modules state"));

      ModuleStateManager.cleanState();
    }

    if (args.cleanWhat === "all") {
      console.log(chalk.green("Cleaning temp files"));

      ModulePackager.cleanTemp();
    }

    process.exit(0);
  }


  protected async handleListModulesCommand(): Promise<void> {
    console.log(chalk.green("-- BEGIN MODULES LIST"));
    for (let module of this.config.modules) {
      console.log(`${ module.name }: ${ module.path }`);
    }
    console.log(chalk.green("-- END MODULES LIST"));

    process.exit(0);
  }


  protected async handleDependencyTreeCommand(): Promise<void> {
    console.log(chalk.green("-- BEGIN DEPENDENCY TREE"));

    let tree = this.config.getDependencyTree(this.config.modules);

    let isFirst = true;

    const printTree = (leaf: ModuleInfo, level: number = 0) => {
      let prefix = level === 0 ? (isFirst ? "- " : "\n- ") : " ".repeat(level * 2 + 2);
      console.log(`${ prefix }${ leaf.name }`);

      let root = tree.find(treeLeaf => treeLeaf.module.name === leaf.name);
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

    console.log(chalk.green("\n-- BEGIN WALK ORDER"));

    await this.config.walkDependencyTree(this.config.modules, async module => {
      console.log(module.name);
    });

    console.log(chalk.green("-- END WALK ORDER"));

    process.exit(0);
  }


  protected async handleFetchCommand(): Promise<void> {
    let args = this.args;

    if (args.subCommand !== "fetch") {
      return;
    }

    this._server = new LocalNpmServer(this);
    await this._server.start();

    try {
      this._fetcher = new ModuleFetcher(this);
      await this.moduleFetcher.fetchModules();

      if (!args.noInstall) {
        await this.moduleFetcher.installModules();
      }
    } finally {
      await this._server.stop();
    }
  }


  protected async handleSyncCommand(): Promise<void> {
    let args = this.args;

    if (args.subCommand !== "sync") {
      return;
    }

    if (args.buildDeps && args.watch) {
      console.log(chalk.red("--build-deps cannot be used with --watch"));
      process.exit();
      return;
    }

    this._server = new LocalNpmServer(this);
    await this._server.start();

    try {
      let argPath = args.path;
      let localModule = this.config.modules.find(module => {
        return module.name === argPath;
      });

      if (!localModule) {
        if (!path.isAbsolute(argPath)) {
          argPath = path.resolve(this.config.mainConfigDir, argPath);
        }

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
          console.log(chalk.red(`No local module found with name "${ argPath }" or at "${ argPath }"`));
          process.exit(-1);
          throw new Error();
        }
      }

      if (!localModule.needsNpmInstall) {
        console.log(chalk.red(`Cannot sync module: 'npmInstall' for module ${ localModule.name } is false`));
        process.exit(-1);
        return;
      }

      if (args.watch) {
        let feeder = new ModulesFeeder(this, [ localModule ]);
        await feeder.start();
      } else {
        let synchronizer = new ModuleSynchronizer(this, localModule);
        await synchronizer.sync(args.buildDeps);
      }
    } finally {
      if (!args.watch) {
        await this._server.stop();
      }
    }
  }


  protected async handleSyncAllCommand(): Promise<void> {
    let args = this.args;

    if (args.subCommand !== "sync-all") {
      return;
    }

    let buildDeps = args.buildDeps;

    this._server = new LocalNpmServer(this);
    await this._server.start();

    try {
      this._fetcher = new ModuleFetcher(this);
      await this._fetcher.fetchModules();
      await this._fetcher.installModules();

      await this.config.walkDependencyTree(this.config.modules, async localModule => {
        if (localModule.needsNpmInstall) {
          let synchronizer = new ModuleSynchronizer(this, localModule);
          await synchronizer.sync(buildDeps);
        } else {
          console.log(chalk.yellow(`Skipping sync for module ${ localModule.name } because npmInstall for this module is false`));
        }
      });
    } finally {
      await this._server.stop();
    }
  }


  protected async handleOutdatedCommand(): Promise<void> {
    let args = this.args;

    if (args.subCommand !== "outdated") {
      return;
    }

    this._server = new LocalNpmServer(this);
    await this._server.start();

    try {
      let results: any = {};
      let index = 1;

      let modsToAnalyze = args.withIncluded ? this.config.modules : this.config.modules.filter(mod => mod.isMain);
      for (let mod of modsToAnalyze) {
        console.log(`[${ index }/${ modsToAnalyze.length }] Analyzing dependencies of "${ mod.name }"...`);
        ++index;

        let result = await this._server.getOutdated(mod);
        if (Object.keys(result).length) {
          results[mod.name] = result;
        }
      }

      if (!args.upgrade) {
        console.log(chalk.green("\n-- REPORT"));
        console.log(this.buildOutdatedReport(results));
      } else {
        await this.upgradeModules(results, args.hard);
      }
    } finally {
      await this._server.stop();
    }
  }


  protected buildOutdatedReport(outdatedData: any): string {
    let depGroups: any = {};

    for (let mod of Object.keys(outdatedData)) {
      for (let dep of Object.keys(outdatedData[mod])) {
        let depData = outdatedData[mod][dep];

        if (dep in depGroups) {
          depGroups[dep][mod] = depData;
        } else {
          depGroups[dep] = { [mod]: depData };
        }
      }
    }

    let lines: string[] = [];

    for (let dep of Object.keys(depGroups)) {
      lines.push(chalk.blue(dep) + ":");

      for (let mod of Object.keys(depGroups[dep])) {
        let depData = depGroups[dep][mod];

        let wanted = depData.wanted !== depData.current ? chalk.yellow(depData.wanted) : depData.wanted;
        let latest = depData.latest !== depData.wanted ? chalk.red(depData.latest) : depData.latest;
        lines.push(`  ${ mod }: installed ${ depData.current }, wanted ${ wanted }, latest ${ latest }`);
      }
    }

    if (!lines.length) {
      lines.push(chalk.green("All modules are up to date"));
    }

    return lines.join("\n");
  }


  protected async upgradeModules(outdatedData: any, hard: boolean): Promise<void> {
    for (let mod of this.config.modules) {
      let modData = outdatedData[mod.name];
      if (!modData) {
        continue;
      }

      for (let dep of Object.keys(modData)) {
        let depData = modData[dep];
        let installVersion = hard ? depData.latest : depData.wanted;
        if (installVersion === depData.current) {
          continue;
        }

        console.log(`Upgrading dependencies of "${ mod.name }": "${ dep }@${ depData.current }" -> "${ dep }@${ installVersion }"`);
        try {
          await this._server!.upgradeDependency(mod, dep, installVersion);
        } catch (error) {
          console.error(chalk.red(`Failed to upgrade dependency of "${ mod.name }": "${ dep }" to version ${ installVersion }`));
        }
      }
    }
  }


  protected async handleCommands(): Promise<void> {
    let args = this._args;

    switch (args.subCommand) {
      case "list-modules":
        await this.handleListModulesCommand();
        break;

      case "dependency-tree":
        await this.handleDependencyTreeCommand();
        break;

      case "clean":
        await this.handleCleanCommand();
        break;

      case "fetch":
        await this.handleFetchCommand();
        break;

      case "sync":
        await this.handleSyncCommand();
        break;

      case "sync-all":
        await this.handleSyncAllCommand();
        break;

      case "outdated":
        await this.handleOutdatedCommand();
        break;

      default:
        throw new Error("Unknown command");
    }
  }


  public async start(): Promise<void> {
    this.parseArgs();

    this._config = Config.findAndLoadConfig(this._args.config || process.cwd(), this._args.ignoreMissingIncludedModules, this);

    return this.handleCommands();
  }
}


export function start(): void {
  let norman = new Norman();

  norman.start().catch((error: Error) => {
    console.log(chalk.red(`Error: ${ error.message }`));
    console.error(error);
    process.exit(-1);
  });
}


process.on("uncaughtException", (error) => {
  console.log(chalk.red(`UNHANDLED EXCEPTION: ${ error.message }: ${ error.stack }`));
  process.exit(-1);
});

process.on("unhandledRejection", (error: any) => {
  console.log(chalk.red(`UNHANDLED REJECTION: ${ error.message }: ${ error.stack }`));
  process.exit(-1);
});
