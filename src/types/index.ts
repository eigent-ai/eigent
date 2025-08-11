type externalConfig = {
  key: string
  name: string
  value: string
  options?: {
    label: string
    value: string
  }[]
}

export type Provider = {
  id: string
  provider_id?: number
  name: string
  apiKey: string
  apiHost: string
  description: string | ""
  hostPlaceHolder?: string
  externalConfig?: externalConfig[]
  is_valid?: boolean,
  model_type?: string,
  prefer?: boolean,
  azure_deployment?: string
}

export type Model = {
  id: string
  name: string
  provider: string
  [key: string]: any
}