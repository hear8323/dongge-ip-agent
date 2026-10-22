export interface CreatorRunPayload {
  action: string
  text: string
  seconds?: number
  profile?: string
}

export interface CreatorRunResult {
  text: string
}
