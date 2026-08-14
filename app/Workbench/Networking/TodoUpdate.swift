/// A partial todo update. Only the non-nil fields are encoded, so changing the
/// priority never sends `done` and cannot reopen a completed task.
struct TodoUpdate: Encodable {
    var done: Bool?
    var priority: TodoPriority?
}
