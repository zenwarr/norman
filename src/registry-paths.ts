import * as url from "url";
import { getConfig } from "./config";
import { getNpmRc } from "./npmrc";
import { ModuleInfo, ModuleNpmName } from "./module-info";


export function resolveRegistryUrl(proxyUrl: string, version: string): string {
  const parsedUrl = new url.URL(proxyUrl);
  const params = parsedUrl.searchParams;

  if (params.has("norman")) {
    const moduleType = params.get("norman");
    if (moduleType === "local") {
      const localModuleName = decodeURIComponent(params.get("name") as string);
      return resolveRemoteTarballForLocalModule(localModuleName, version);
    } else {
      return decodeURIComponent(params.get("url") as string);
    }
  } else {
    return proxyUrl;
  }
}


export function resolveRemoteTarballForLocalModule(moduleName: string, version: string): string {
  const config = getConfig();
  const module = config.getModuleInfo(moduleName);
  if (!module) {
    throw new Error(`Failed to resolve remote tarball URL for local module "${ moduleName }": local module not found`);
  } else {
    const registry = getRegistryForModule(module);
    return buildTarballUrl(registry, module.npmName, version);
  }
}


function buildTarballUrl(registry: string, moduleName: ModuleNpmName, version: string) {
  if (!registry.endsWith("/")) {
    registry += "/";
  }

  return `${ registry }${ moduleName.name }/-/${ moduleName.pkg }-${ version }.tgz`;
}


export function getRegistryForModule(module: ModuleInfo) {
  const npmrc = getNpmRc();
  return npmrc.getCustomRegistry("@" + module.npmName.org) || npmrc.defaultRegistry;
}
