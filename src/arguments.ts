import { ServiceLocator } from "./locator";
import * as argparse from "argparse";
import * as path from "path";
import { ReleaseType } from "./release/release-types";


export type Arguments = {
  config: string | null;
  ignoreMissingIncludedModules: boolean;
} & ({
  subCommand: "sync";
} | {
  subCommand: "sync-all";
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
} | {
  subCommand: "npm";
  args: string[];
} | {
  subCommand: "publish";
} | {
  subCommand: "server";
} | {
  subCommand: "release";
  releaseCommand: string;
  beginReleaseType: ReleaseType;
});


export class ArgumentsManager {
  public get args() {
    return this._args;
  }

  protected constructor() {
    let argparser = new argparse.ArgumentParser({
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

    subparsers.addParser("sync", { help: "Synchronizes a local module at current working directory" });

    subparsers.addParser("sync-all", { help: "Synchronize all local modules" });

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

    let npmParser = subparsers.addParser("npm", { help: "Run npm command" });
    npmParser.addArgument("args", {
      help: "npm command arguments",
      nargs: argparse.Const.REMAINDER,
      defaultValue: []
    });

    subparsers.addParser("publish", { help: "Publish module" });

    subparsers.addParser("server", { help: "Start local npm registry server" });

    let releaseParser = subparsers.addParser("release", { help: "Release management" });
    let releaseCommandParser = releaseParser.addSubparsers({
      title: "Release command",
      dest: "releaseCommand"
    });
    let releaseBeginParser = releaseCommandParser.addParser("begin", { help: "Begin a new release" });
    releaseBeginParser.addArgument("beginReleaseType", {
      help: "Release type",
      choices: [ "minor", "major", "patch", "hotfix" ]
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
