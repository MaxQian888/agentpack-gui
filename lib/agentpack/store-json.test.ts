import { readStoreRecords } from "./store-json"

describe("readStoreRecords", () => {
  it("returns the profile records of a well-formed store", () => {
    const recs = readStoreRecords('{"version":1,"profiles":[{"id":"a"},{"id":"b"}]}')
    expect(recs).toEqual([{ id: "a" }, { id: "b" }])
  })

  it("degrades to nothing rather than throwing on unparseable input", () => {
    // A hand-edited file that lost a brace must not take the section down.
    expect(readStoreRecords("{not json")).toEqual([])
  })

  it("treats empty and whitespace-only text as an empty store", () => {
    expect(readStoreRecords("")).toEqual([])
    expect(readStoreRecords("   \n ")).toEqual([])
  })

  it("ignores a store whose profiles key is missing or the wrong type", () => {
    expect(readStoreRecords('{"version":1}')).toEqual([])
    expect(readStoreRecords('{"profiles":"nope"}')).toEqual([])
    expect(readStoreRecords('{"profiles":{}}')).toEqual([])
  })

  it("ignores a top-level value that isn't an object", () => {
    expect(readStoreRecords("[1,2,3]")).toEqual([])
    expect(readStoreRecords('"a string"')).toEqual([])
    expect(readStoreRecords("null")).toEqual([])
  })

  it("drops non-object entries so callers only index real records", () => {
    const recs = readStoreRecords('{"profiles":[{"id":"a"},null,42,"x",{"id":"b"}]}')
    expect(recs).toEqual([{ id: "a" }, { id: "b" }])
  })
})
