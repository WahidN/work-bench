import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { fetchPr, type Pr } from './github'
import { postRemark, type Posted } from './post'
import { reviewPr, type Remark, type Reviewed } from './review'

export type SavedRemark = Remark & { posted?: string }

export type SavedReview =
  | { url: string; state: 'running'; pid: number }
  | { url: string; state: 'done'; commit: string; remarks: SavedRemark[] }
  | { url: string; state: 'failed'; error: string }

const REVIEWS_FOLDER = join(homedir(), '.config', 'workbench', 'reviews')

function prFromUrl(url: string): Pick<Pr, 'repo' | 'number'> {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/)
  if (!match) throw new Error(`Not a pull request URL: ${url}`)
  return { repo: match[1], number: Number(match[2]) }
}

export function reviewFile(url: string, folder = REVIEWS_FOLDER): string {
  const { repo, number } = prFromUrl(url)
  return join(folder, repo, `${number}.json`)
}

// Raycast reads the file while the review writes it, and a rename never shows half a file.
export async function saveReview(review: SavedReview, folder = REVIEWS_FOLDER): Promise<void> {
  const file = reviewFile(review.url, folder)
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(review, null, 2)}\n`)
  await rename(temp, file)
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (failure) {
    return (failure as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// A review that crashed never wrote its result, so its file still says running.
function settled(review: SavedReview): SavedReview {
  if (review.state !== 'running' || isRunning(review.pid)) return review
  return { url: review.url, state: 'failed', error: 'The review stopped before it was done' }
}

async function readReview(file: string): Promise<SavedReview> {
  return settled(JSON.parse(await readFile(file, 'utf8')))
}

export async function loadReview(url: string, folder = REVIEWS_FOLDER): Promise<SavedReview | null> {
  return readReview(reviewFile(url, folder)).catch((failure) => {
    if (failure.code === 'ENOENT') return null
    throw failure
  })
}

export async function loadReviews(folder = REVIEWS_FOLDER): Promise<SavedReview[]> {
  const files = await readdir(folder, { recursive: true }).catch((failure) => {
    if (failure.code === 'ENOENT') return []
    throw failure
  })
  return Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => readReview(join(folder, file))))
}

type ReviewOptions = {
  lookup?: (url: string) => Promise<Pick<Pr, 'url' | 'title'>>
  review?: (pr: Pick<Pr, 'url' | 'title'>) => Promise<Reviewed>
  folder?: string
}

export async function runReview(
  url: string,
  { lookup = fetchPr, review = reviewPr, folder = REVIEWS_FOLDER }: ReviewOptions = {},
): Promise<SavedReview> {
  if ((await loadReview(url, folder))?.state === 'running') {
    throw new Error('A review of this pull request is still running')
  }
  await saveReview({ url, state: 'running', pid: process.pid }, folder)

  let result: SavedReview
  try {
    result = { url, state: 'done', ...(await review(await lookup(url))) }
  } catch (failure) {
    result = { url, state: 'failed', error: failure instanceof Error ? failure.message : String(failure) }
  }
  await saveReview(result, folder)
  return result
}

type PostOptions = {
  post?: (pr: Pick<Pr, 'repo' | 'number'>, commit: string, remark: Remark) => Promise<Posted>
  folder?: string
}

export async function postSaved(
  url: string,
  commit: string,
  index: number,
  { post = postRemark, folder = REVIEWS_FOLDER }: PostOptions = {},
): Promise<Posted> {
  const saved = await loadReview(url, folder)
  if (saved?.state !== 'done' || saved.commit !== commit) {
    throw new Error(`The saved review is not of commit ${commit}`)
  }
  const remark = saved.remarks[index]
  if (!remark) throw new Error(`The saved review has no remark ${index}`)
  if (!remark.inDiff) throw new Error('This remark is on a line that is not in the diff')
  if (remark.posted) throw new Error(`This remark is already posted: ${remark.posted}`)

  const posted = await post(prFromUrl(url), commit, remark)
  saved.remarks[index] = { ...remark, posted: posted.url }
  await saveReview(saved, folder)
  return posted
}
