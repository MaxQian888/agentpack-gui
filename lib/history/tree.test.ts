import { branchOptions, messagesForLeaf } from "./tree"
import type { Message, SessionTree } from "./types"

const message = (id: string, text: string): Message => ({
  id,
  role: "assistant",
  ts: null,
  model: null,
  parts: [
    {
      kind: "text",
      text,
      name: null,
      agent: null,
      callId: null,
      isError: null,
      truncated: null,
      fullBytes: null,
      ref: null,
    },
  ],
  usage: null,
})

const tree: SessionTree = {
  activeLeafId: "right",
  nodes: [
    { id: "root", parentId: null, kind: "message", label: null, message: message("m1", "root") },
    {
      id: "left",
      parentId: "root",
      kind: "message",
      label: "Earlier answer",
      message: message("m2", "left"),
    },
    {
      id: "right",
      parentId: "root",
      kind: "message",
      label: null,
      message: message("m3", "right"),
    },
  ],
}

it("selects only the shared ancestor and chosen leaf path", () => {
  expect(messagesForLeaf(tree, "left").map((item) => item.id)).toEqual(["m1", "m2"])
  expect(messagesForLeaf(tree, "right").map((item) => item.id)).toEqual(["m1", "m3"])
})

it("lists tree leaves and preserves an explicit Pi branch label", () => {
  expect(branchOptions(tree, (number) => `Branch ${number}`)).toEqual([
    { id: "left", label: "Earlier answer" },
    { id: "right", label: "Branch 2" },
  ])
})
