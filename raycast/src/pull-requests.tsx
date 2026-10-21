import { Action, ActionPanel, closeMainWindow, Icon, Keyboard, List } from '@raycast/api'
import { showFailureToast, useCachedPromise } from '@raycast/utils'

import { listPrs, openInWorkbench, type Pr } from './workbench'

const REASON_LABEL: Record<Pr['reasons'][number], string> = { assigned: 'Assigned', review: 'Review' }

async function openPr(url: string) {
  try {
    await openInWorkbench(url)
    await closeMainWindow()
  } catch (failure) {
    await showFailureToast(failure, { title: 'Could not open Workbench' })
  }
}

function PrItem({ pr }: { pr: Pr }) {
  return (
    <List.Item
      title={pr.title}
      subtitle={`${pr.repo}#${pr.number}`}
      keywords={pr.repo.split('/')}
      accessories={[
        ...(pr.commented ? [{ tag: 'Commented' }] : []),
        { text: pr.reasons.map((reason) => REASON_LABEL[reason]).join(', ') },
        { text: pr.author, icon: Icon.Person },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={pr.url} />
          <Action title="Open in Workbench" icon={Icon.Window} onAction={() => openPr(pr.url)} />
          <Action.CopyToClipboard title="Copy URL" content={pr.url} shortcut={Keyboard.Shortcut.Common.Copy} />
        </ActionPanel>
      }
    />
  )
}

export default function PullRequests() {
  // The error view below says what went wrong, so no toast on top of it.
  const { data, error, isLoading } = useCachedPromise(listPrs, [], { onError: () => {} })

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter by title or repo">
      {error ? (
        <List.EmptyView icon={Icon.Warning} title="Could not load pull requests" description={error.message} />
      ) : (
        data?.map((pr) => <PrItem key={pr.url} pr={pr} />)
      )}
    </List>
  )
}
