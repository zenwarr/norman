import { ModuleInfo } from "../module-info";
import { getConfig } from "../config";
import { getDirectLocalDeps } from "../dry-dependency-tree";


export async function dependencyTreeCommand() {
  let isFirst = true;

  const printModuleTree = (leaf: ModuleInfo, level: number = 0) => {
    let prefix = level === 0 ? (isFirst ? "- " : "\n- ") : " ".repeat(level * 2 + 2);
    console.log(`${ prefix }${ leaf.name }`);

    const deps = getDirectLocalDeps(leaf);
    for (let dep of deps) {
      printModuleTree(dep, level + 1);
    }
  };

  for (let treeRoot of getConfig().modules) {
    printModuleTree(treeRoot);
    isFirst = false;
  }
}
