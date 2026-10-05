import { fetchMyPrs } from './github'

const [command] = process.argv.slice(2)

if (command !== 'prs') {
  console.error('Usage: bun src/cli.ts prs')
  process.exit(1)
}

try {
  console.log(JSON.stringify(await fetchMyPrs()))
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure))
  process.exit(1)
}
