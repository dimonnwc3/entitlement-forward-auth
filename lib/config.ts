import { YAML } from "bun"
import { z } from "zod"

export const HEADER_APP = "X-Auth-App"
export const HEADER_USER = "X-Auth-User"
export const HEADER_TIMESTAMP = "X-Auth-Timestamp"
export const HEADER_SIGNATURE = "X-Auth-Signature"

export const RESPONSE_HEADER_APP = "X-Forwarded-App"
export const RESPONSE_HEADER_USER = "X-Forwarded-User"

export const authHeadersSchema = z.strictObject({
  app: z.string().min(1).default(HEADER_APP),
  user: z.string().min(1).default(HEADER_USER),
  timestamp: z.string().min(1).default(HEADER_TIMESTAMP),
  signature: z.string().min(1).default(HEADER_SIGNATURE),
})

export type AuthHeaders = z.infer<typeof authHeadersSchema>

export const providerSchema = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("revenuecat"),
    secretKey: z.string().min(1),
  }),
  z.strictObject({ name: z.literal("adapty"), secretKey: z.string().min(1) }),
  z.strictObject({ name: z.literal("apphud"), apiKey: z.string().min(1) }),
  z.strictObject({
    name: z.literal("qonversion"),
    secretKey: z.string().min(1),
  }),
  z.strictObject({
    name: z.literal("iaphub"),
    apiKey: z.string().min(1),
    appId: z.string().min(1),
  }),
])

export type AppProvider = z.infer<typeof providerSchema>
export type ProviderConfig<N extends AppProvider["name"]> = Omit<
  Extract<AppProvider, { name: N }>,
  "name"
>
export type RevenueCatConfig = ProviderConfig<"revenuecat">
export type AdaptyConfig = ProviderConfig<"adapty">
export type ApphudConfig = ProviderConfig<"apphud">
export type QonversionConfig = ProviderConfig<"qonversion">
export type IaphubConfig = ProviderConfig<"iaphub">

export const responseHeadersSchema = z.strictObject({
  app: z.string().min(1).default(RESPONSE_HEADER_APP),
  user: z.string().min(1).default(RESPONSE_HEADER_USER),
})

export const appSchema = z.strictObject({
  signingSecrets: z.array(z.string().min(1)).min(1).optional(),
  provider: providerSchema,
})

export type AppEntry = z.infer<typeof appSchema>

export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "TRACE",
  "CONNECT",
] as const

export type Method = (typeof HTTP_METHODS)[number]

// exact when plain ("/v1/complete"), segment-safe prefix when it ends with "/*" ("/v1/*", "/*")
const pathSchema = z
  .string()
  .min(1)
  .refine(
    (p) => {
      if (!p.startsWith("/")) return false
      const stars = p.split("*").length - 1
      return stars === 0 || (stars === 1 && p.endsWith("/*"))
    },
    { message: 'must be an exact path "/v1/complete" or a prefix "/v1/*"' },
  )

export const routeSchema = z.strictObject({
  host: z.string().min(1).optional(),
  paths: z.array(pathSchema).min(1).optional(),
  methods: z.enum(HTTP_METHODS).array().min(1).optional(),
  entitlements: z.array(z.string().min(1)).default([]),
  headers: z.record(z.string(), z.string()).optional(),
})

export type Route = z.infer<typeof routeSchema>

export const configSchema = z
  .strictObject({
    defaultApp: z.string().optional(),
    apps: z.record(z.string(), appSchema).default({}),
    routes: z.array(routeSchema).default([]),
    authHeaders: authHeadersSchema.prefault({}),
    responseHeaders: responseHeadersSchema.prefault({}),
  })
  .superRefine((config, ctx) => {
    if (config.defaultApp && !Object.hasOwn(config.apps, config.defaultApp)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultApp"],
        message: `unknown app "${config.defaultApp}", must be a key of apps`,
      })
    }

    for (const [i, a] of config.routes.entries()) {
      for (const [j, b] of config.routes.entries()) {
        if (j <= i) continue
        if ((a.host ?? null) !== (b.host ?? null)) continue
        // overlapping patterns are fine (longest match wins), identical strings are not
        const duplicate = a.paths?.find((p) => b.paths?.includes(p))
        if (duplicate) {
          ctx.addIssue({
            code: "custom",
            path: ["routes", j],
            message: `duplicate route ${a.host ?? "(any host)"} ${duplicate}, already defined at index ${i}`,
          })
        }
      }
    }
  })

export type Config = z.infer<typeof configSchema>

const configPath = process.env.CONFIG_PATH ?? "config.yaml"

export const config = configSchema.parse(
  YAML.parse(await Bun.file(configPath).text()) ?? {},
)
