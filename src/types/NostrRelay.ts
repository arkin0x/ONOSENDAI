export type RelayReadWrite = {
  read: boolean,
  write: boolean,
}

export type RelayObject = {
  [key: string]: RelayReadWrite
}

export type RelayList = string[]

export type FilterReadWrite = ['read' | 'write' ]