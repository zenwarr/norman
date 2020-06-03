import * as url from "url";
import { getProject } from "./project";
import { getNpmRc } from "./npmrc";
import { LocalModule, ModuleNpmName } from "./local-module";


export function getRegistryForPackage(name: ModuleNpmName) {
  const npmrc = getNpmRc();
  return npmrc.getCustomRegistry("@" + name.scope) || npmrc.defaultRegistry;
}
