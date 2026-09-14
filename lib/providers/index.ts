import type { AppProvider, ProviderConfig } from "#/lib/config"
import { adapty } from "./adapty"
import { apphud } from "./apphud"
import { iaphub } from "./iaphub"
import { qonversion } from "./qonversion"
import { revenuecat } from "./revenuecat"
import type { Provider } from "./types"

export const providers: {
  [K in AppProvider["name"]]: Provider<ProviderConfig<K>>
} = {
  revenuecat,
  adapty,
  apphud,
  qonversion,
  iaphub,
}
