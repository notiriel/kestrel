List and manage workspace TODOs for the current workspace via Kestrel DBus.

Run the following command to list current tasks:

```bash
gdbus call --session --dest org.gnome.Shell \
  --object-path /io/kestrel/Extension \
  --method io.kestrel.Extension.ListTodos
```

Present the result as a numbered task list. If the list is empty, say so.

The user or you can then request:
- **Add a task**: Call `AddTodo` with the task text:
  ```bash
  gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.AddTodo \
    "task text here"
  ```
- **Complete a task**: Call `CompleteTodo` with the task's UUID (from the list output):
  ```bash
  gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.CompleteTodo \
    "uuid-here"
  ```

After any add or complete operation, re-list the tasks to show the updated state.
