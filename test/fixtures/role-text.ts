/**
 * The exact model-facing role texts from the expansion contract. Tests keep
 * these golden strings independent of the implementation.
 */

export function dispatch(name: string, task: string): string {
  return (
    `[subagent dispatch: role "${name}"]\n` +
    `Call the \`subagent\` tool now and delegate the rest of this message to the \`${name}\` role. ` +
    `Call it with \`tasks: [{ "agent": "${name}", "task": "<the rest of this message>" }]\`, ` +
    `using the text after this line as the \`task\` brief. ` +
    "Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, " +
    "but keep the user's intent and wording. " +
    `Do not do the task yourself.\n\n${task}`
  );
}

export function noTask(name: string): string {
  return (
    `[subagent dispatch: role "${name}"]\n` +
    `The user selected the \`${name}\` role but gave no task. ` +
    `Do not call the \`subagent\` tool. Ask the user what to delegate to \`${name}\`.`
  );
}
