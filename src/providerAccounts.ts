import type { PaymentMethodFamily, PortOneEasyPayProvider, Provider, ProviderAccount } from "./types.js";

export class ProviderAccountRegistry {
  constructor(private readonly accounts: ProviderAccount[]) {}

  listEnabled(): ProviderAccount[] {
    return this.accounts.filter((account) => account.enabled);
  }

  availableMethods(): Array<{ id: string; easyPayProvider: PortOneEasyPayProvider; label: string }> {
    return this.listEnabled().map((account) => ({
      id: account.id,
      easyPayProvider: account.easyPayProvider,
      label: account.displayName,
    }));
  }

  findEnabled(id: string): ProviderAccount | undefined {
    return this.accounts.find((account) => account.id === id && account.enabled);
  }

  supports(provider: Provider, paymentMethodFamily: PaymentMethodFamily): boolean {
    return this.accounts.some(
      (account) =>
        account.enabled && account.provider === provider && account.paymentMethodFamily === paymentMethodFamily,
    );
  }
}
