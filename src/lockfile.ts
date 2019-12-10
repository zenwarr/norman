import * as fs from "fs-extra";
import * as path from "path";
import { resolveRegistryUrl } from "./registry-paths";
import { getConfig } from "./config";
import { ModulePackager } from "./module-packager";
import { ModuleInfo } from "./module-info";


const LOCKFILE_NAME = "package-lock.json";


export type DependencyMap = { [name: string]: LockfileDependency };

export type DependencyWalker = (dependency: LockfileDependency, name: string, path: string) => void;


export interface LockfileDependency {
  version: string;
  integrity?: string;
  resolved?: string;
  bundled?: boolean;
  dev?: boolean;
  optional?: boolean;
  requires?: { [name: string]: string };
  dependencies?: DependencyMap;
}


export interface LockfileContent {
  dependencies?: DependencyMap;
}


export class Lockfile {
  public get filename() {
    return this._filename;
  }


  public constructor(private _filename: string) {

  }


  public static getPathForDir(dir: string): string {
    return path.join(dir, LOCKFILE_NAME);
  }


  public static forModule(module: ModuleInfo) {
    return new Lockfile(this.getPathForDir(module.path));
  }


  public static existsInDir(dir: string) {
    return fs.existsSync(this.getPathForDir(dir));
  }


  public updateResolveUrl() {
    this.mutateDependencies(dep => {
      if (dep.resolved) {
        dep.resolved = resolveRegistryUrl(dep.resolved, dep.version);
      }
    });
  }


  public updateIntegrity() {
    const config = getConfig();

    this.mutateDependencies((dep, name) => {
      const localModule = config.getModuleInfo(name);
      if (!localModule) {
        return;
      }

      const packager = new ModulePackager(localModule);
      dep.integrity = packager.getActualTarballIntegrity();
    });
  }


  private load(): LockfileContent {
    const content: any = fs.readJSONSync(this._filename);
    if (typeof content !== "object") {
      throw new Error(this.validationErrorText("content not an object"));
    }

    if ("lockfileVersion" in content && content.lockfileVersion !== 1) {
      throw new Error(this.validationErrorText(`unsupported version ${ content.lockfileVersion }, expected 1`));
    }

    if ("dependencies" in content && typeof content.dependencies !== "object") {
      throw new Error(this.validationErrorText("dependencies is not an object"));
    }

    return content;
  }


  private validationErrorText(text: string) {
    return `Lockfile "${ this.filename }" is invalid: ${ text }`;
  }


  private mutateDependencies(walker: DependencyWalker): void {
    const content = this.load();
    if (content.dependencies) {
      this._walkDependencies("", content.dependencies, walker);
    }
    fs.writeJSONSync(this.filename, content, {
      spaces: 2
    });
  }


  private _walkDependencies(parentPath: string, deps: DependencyMap, walker: DependencyWalker) {
    for (const depName of Object.keys(deps)) {
      const dep = deps[depName];
      const depPath = parentPath ? `${ parentPath }/${ depName }` : depName;

      if (dep.dependencies) {
        this._walkDependencies(depPath, dep.dependencies, walker);
      }

      walker(dep, depName, depPath);
    }
  }
}
