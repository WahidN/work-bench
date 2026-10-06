import { fetchMyPrs } from './github'
import { loadHiddenRepos } from './hidden'
import { withoutHidden } from './repos'

const [command] = process.argv.slice(2)

if (command !== 'prs') {
  console.error('Usage: bun src/cli.ts prs')
  process.exit(1)
}

try {
  const [prs, hidden] = await Promise.all([fetchMyPrs(), loadHiddenRepos()])
  console.log(JSON.stringify(withoutHidden(prs, hidden)))
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure))
  process.exit(1)
}
