import * as fs from "fs-extra";
import * as path from "path";
import * as url from "url";
import { LocalModule, npmNameFromPackageName } from "./local-module";
import { getRegistryForPackage } from "./registry-paths";
import { getRegistry } from "./registry";


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


function getHostFromUrl(u: string) {
  return new url.URL(u).host;
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


  public static forModule(module: LocalModule) {
    return new Lockfile(this.getPathForDir(module.path));
  }


  public static existsInDir(dir: string) {
    return fs.existsSync(this.getPathForDir(dir));
  }


  public static existsInModule(mod: LocalModule) {
    return this.existsInDir(mod.path);
  }


  public updateResolveUrl(localHost: string) {
    let registryHost = getHostFromUrl(getRegistry().address);

    this.mutateDependencies(dep => {
      if (dep.resolved) {
        dep.resolved = this.resolveRegistryUrl(dep.resolved, registryHost);
      }
    });
  }


  private resolveRegistryUrl(oldResolvedUrl: string, registryHost: string) {
    let parsedURL = new url.URL(oldResolvedUrl);
    if (parsedURL.host !== registryHost) {
      return oldResolvedUrl;
    }

    let pathParts = parsedURL.pathname.split("/");
    if (pathParts.length < 2) {
      return oldResolvedUrl;
    }

    let packageName = decodeURIComponent(pathParts[1]);

    parsedURL.host = getHostFromUrl(getRegistryForPackage(npmNameFromPackageName(packageName)));
    parsedURL.port = "";

    return parsedURL.toString();
  }


  private load(): LockfileContent {
    const content: any = fs.readJSONSync(this._filename);
    if (typeof content !== "object") {
      throw new Error(this.getValidationErrorText("content not an object"));
    }

    if ("lockfileVersion" in content && content.lockfileVersion !== 1) {
      throw new Error(this.getValidationErrorText(`unsupported version ${ content.lockfileVersion }, expected 1`));
    }

    if ("dependencies" in content && typeof content.dependencies !== "object") {
      throw new Error(this.getValidationErrorText("dependencies is not an object"));
    }

    return content;
  }


  private getValidationErrorText(text: string) {
    return `Lockfile "${ this.filename }" is invalid: ${ text }`;
  }


  private mutateDependencies(walker: DependencyWalker): void {
    const content = this.load();
    if (content.dependencies) {
      this._walkDependencies(undefined, content.dependencies, walker);
    }
    fs.writeJSONSync(this.filename, content, {
      spaces: 2
    });
  }


  private _walkDependencies(parentPath: string | undefined, deps: DependencyMap, walker: DependencyWalker) {
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
