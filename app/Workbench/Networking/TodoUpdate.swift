/// A partial todo update. Only the non-nil fields are encoded, so changing the
/// priority never sends `done` and cannot reopen a completed task.
struct TodoUpdate: Encodable {
    var done: Bool?
    var priority: TodoPriority?
}

// A dictionary literal cannot carry both a String and an Int, and an absent
// projectId must be absent from the JSON rather than null, so this is a struct.
struct CreateTodoBody: Encodable {
    let text: String
    var projectId: Int?
}
