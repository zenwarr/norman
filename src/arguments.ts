import { ServiceLocator } from "./locator";
import { ArgumentParser } from "argparse";
import * as path from "path";


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


export class ArgumentsManager {
  public get args() {
    return this._args;
  }

  protected constructor() {
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

  private readonly _args: Arguments;

  public static init() {
    const parser = new ArgumentsManager();
    ServiceLocator.instance.initialize("args", parser);
  }
}


export function getArgs() {
  return ServiceLocator.instance.get<ArgumentsManager>("args").args;
}
