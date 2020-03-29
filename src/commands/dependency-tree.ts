import { LocalModule } from "../local-module";
import { getDirectLocalDeps, walkAllLocalModules } from "../dry-dependency-tree";
import * as columnify from "columnify";


export async function dependencyTreeCommand() {
  function getName(leaf: LocalModule) {
    return leaf.name ? leaf.name.name : "<no name>";
  }

  let output: { name: string; deps: string }[] = [];

  async function printModuleTree(leaf: LocalModule) {
    let deps = getDirectLocalDeps(leaf).map(getName);
    let depsLine = deps.length ? `[${ deps.join(", ") }]` : "";

    output.push({
      name: getName(leaf),
      deps: depsLine
    });
  }

  await walkAllLocalModules(printModuleTree);

  console.log(columnify(output, {
    columnSplitter: " | "
  }));
}
