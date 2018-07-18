# What is it?

An utility to simplify development of multi-package node applications.

# Why not use `npm link` instead?

1. `npm link` is global.
   Anything global is bad (although there are exceptions).
2. In general case, you cannot have `node_modules` directory inside a linked package, because the package does not know it was linked somewhere.
  When the linked package requires another package, it looks for it in its own `node_modules`, not in `node_modules` of the application it was linked to.
  In most cases it does work, but some packages (especially ones that use singleton instances) are not happy to be imported that way, creating numerous hard-to-catch bugs.
3. `npm link` has problems.

# Why you shouldn't use `norman`

1.
