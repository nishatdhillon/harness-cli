import { URL } from 'url'
import { GraphQLClient } from '../../util/graphql-client'
import { Applications } from './applications'
import { Secrets } from './secrets'
import { Environments } from './environments'
import { CloudProviders } from './cloud-providers'
import { Groups } from './groups'
import { Users } from './users'
import axios, { AxiosInstance } from 'axios'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axiosRateLimit = require('axios-rate-limit')
import { ConfigAsCode } from './config-as-code'
import { Config } from '../../util/config'
import { SecretManagers } from './secret-managers'
import { Connectors } from './connectors/connectors'

export interface HarnessApiOptions {
    accountId: string,
    apiKey?: string,
    username?: string,
    password?: string,
    managerUrl?: string,
    bearerToken?: string,
    url?: string,
    rateLimit?: boolean,
}

const defaultManagerUrl = 'https://app.harness.io'
let http = axios.create()

export class Harness {
    managerUrl: string;
    accountId: string;
    apiKey?: string;
    username?: string;
    password?: string;
    bearerToken?: string;
    
    client!: GraphQLClient;
    applications!: Applications;
    connectors!: Connectors
    secrets!: Secrets;
    secretManagers!: SecretManagers
    environments!: Environments
    cloudProviders!: CloudProviders
    groups!: Groups
    users!: Users
    configAsCode!: ConfigAsCode

    constructor(options?: HarnessApiOptions) {
        options = options || Config.Harness

        this.managerUrl = new URL(options.url || defaultManagerUrl).origin

        this.apiKey = options.apiKey || Config.Harness.apiKey
        this.username = options.username || Config.Harness.username
        this.password = options.password || Config.Harness.password
        this.accountId = options.accountId || Config.Harness.accountId

        if (options.rateLimit) {
            // I think i'd rather use https://www.npmjs.com/package/bottleneck instead
            http = axiosRateLimit(axios.create(), { maxRequests: 1, perMilliseconds: 1500 }) as AxiosInstance
        }
    }

    async init() {
        const headers: any = { 'Content-Type': 'application/json' }
        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey
        } else if (this.username && this.password) {
            const account = await Harness.login(this.username, this.password, this.managerUrl)
            this.bearerToken = account.token
            headers.authorization = `Bearer ${this.bearerToken}`
        } else {
            throw new Error('Either API Key or username/password are required')
        }

        this.client = new GraphQLClient(`${this.managerUrl}/gateway/api/graphql?accountId=${this.accountId}`, headers)

        this.secrets = new Secrets(this.client)
        this.secretManagers = new SecretManagers(this.client)
        this.applications = new Applications(this.client)
        this.connectors = new Connectors(this.client)
        this.environments = new Environments(this.client, this)
        this.cloudProviders = new CloudProviders(this.client)
        this.groups = new Groups(this.client)
        this.users = new Users(this.client)
        this.configAsCode = new ConfigAsCode(this)
    }

    static async login(username: string, password: string, managerUrl?: string) {
        const data = {
            authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
        }
        
        const response = await http.post(`${new URL(managerUrl || defaultManagerUrl).origin}/gateway/api/users/login`, data)

        return {
            token: response.data.resource.token,
            defaultAccountId: response.data.resource.defaultAccountId as string,
            accounts: response.data.resource.accounts
                .concat(response.data.resource.supportAccounts)
                .map((a: { accountName: string; companyName: string; uuid: string }) => {
                    return { name: a.accountName, company: a.companyName, id: a.uuid }
                }),
        }
    }

    static async fromUrl(url: string) {
        const parsed = new URL(url)

        const options: HarnessApiOptions = {
            url: parsed.origin,
            accountId: '',
        }

        const accountId = parsed.searchParams.get('accountId') 

        if (parsed.username && !parsed.password) {
            options.apiKey = decodeURIComponent(parsed.username)
            if (!accountId) {
                throw new Error('Account id is required when authenticating via API key')
            }
            options.accountId = accountId
        } else if (parsed.username) {
            options.username = decodeURIComponent(parsed.username)
            options.password = decodeURIComponent(parsed.password)
        } else {
            throw new Error('Either API key or username/password are required')
        }

        const harness = new Harness(options)
        await harness.init()
        return harness
    }

    async privateApiGet(path: string) {    
        const url = new URL(path, this.managerUrl)
        url.searchParams.append('accountId', this.accountId)
        const headers: any = {}
        if (this.bearerToken) {
            headers.Authorization = `Bearer ${this.bearerToken}`
        } else if (this.apiKey) {
            headers['x-api-key'] = this.apiKey
        }
        const response = await http.get(url.href, {
            headers: headers,
        })
        
        return response.data
    }

    async privateApiPost(path: string, data: any, headers?: any, opts?: any) {
        const url = new URL(path, this.managerUrl)
        url.searchParams.append('accountId', this.accountId)

        headers = headers || {}
        if (this.bearerToken) {
            headers.Authorization = `Bearer ${this.bearerToken}`
        } else if (this.apiKey) {
            headers['x-api-key'] = this.apiKey
        }

        const response = await http.post(url.href, data, {
            headers: headers,
            timeout: opts?.timeout,
        })

        if (response.data?.resource?.responseStatus === 'FAILED') {
            throw response.data.resource
        }
        
        return response.data
    }

    async privateApiPut(path: string, data: any, headers?: any, opts?: any) {
        const url = new URL(path, this.managerUrl)
        url.searchParams.append('accountId', this.accountId)

        headers = headers || {}
        if (this.bearerToken) {
            headers.Authorization = `Bearer ${this.bearerToken}`
        } else if (this.apiKey) {
            headers['x-api-key'] = this.apiKey
        }

        const response = await http.put(url.href, data, {
            headers: headers,
            timeout: opts?.timeout,
        })

        if (response.data?.resource?.responseStatus === 'FAILED') {
            throw response.data.resource
        }
        
        return response.data
    }

    async privateApiDelete(path: string) {
        const url = new URL(path, this.managerUrl)
        url.searchParams.append('accountId', this.accountId)
        const headers: any = {}
        if (this.bearerToken) {
            headers.Authorization = `Bearer ${this.bearerToken}`
        } else if (this.apiKey) {
            headers['x-api-key'] = this.apiKey
        }

        const response = await http.delete(url.href, {
            headers: headers,
        })
        return response.data
    }
}
