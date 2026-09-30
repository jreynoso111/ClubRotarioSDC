export type FinanceDirection = "income" | "expense";

export type FinanceCategory =
  | "monthly_dues"
  | "activity_contribution"
  | "donation"
  | "other_income"
  | "activity_expense"
  | "operating_expense"
  | "other_expense";

export type FinanceEntryCategory = Exclude<FinanceCategory, "monthly_dues">;

export type FinancePaymentMethod =
  | "cash"
  | "bank_transfer"
  | "card"
  | "check"
  | "other";

export type FinancePeriodSummary = {
  incomeTotal: string;
  expenseTotal: string;
  balance: string;
  duesTotal: string;
  duesPaid: string;
  duesOutstanding: string;
  duesCount: number;
};

export type FinanceMonthlyDue = {
  id: string;
  memberId: string | null;
  memberName: string;
  dueMonth: string;
  amountDue: string;
  amountPaid: string;
};

export type FinanceLedgerEntry = {
  id: string;
  direction: FinanceDirection;
  category: FinanceCategory;
  amount: string;
  occurredOn: string;
  description: string;
  memberId: string | null;
  memberName: string | null;
  counterpartyName: string | null;
  activityId: string | null;
  activityName: string | null;
  monthlyDueId: string | null;
  paymentMethod: FinancePaymentMethod;
  receiptReference: string | null;
};

export type FinanceOption = { id: string; name: string };

export type FinanceDashboard = {
  monthStart: string;
  summary: FinancePeriodSummary;
  dues: FinanceMonthlyDue[];
  entries: FinanceLedgerEntry[];
  members: FinanceOption[];
  activities: FinanceOption[];
};

export const financeCategoryLabels: Record<FinanceCategory, string> = {
  monthly_dues: "Aporte mensual",
  activity_contribution: "Aporte para actividad",
  donation: "Donación",
  other_income: "Otro ingreso",
  activity_expense: "Gasto de actividad",
  operating_expense: "Gasto operativo",
  other_expense: "Otro egreso",
};

export const financePaymentMethodLabels: Record<FinancePaymentMethod, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  card: "Tarjeta",
  check: "Cheque",
  other: "Otro",
};
