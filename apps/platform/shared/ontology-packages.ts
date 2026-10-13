/** Native ontology imports are reviewed, immutable and scoped to a System. */
export interface OntologyPackagePin { id: string; version: string; hash: string }
export interface NativeOntologyPackage {
  format: "artyfact.ontology-package@1";
  id: string;
  version: string;
  dependencies: OntologyPackagePin[];
  /** Native meta@1 sources keyed by their exact template.<name>@<version> ref. */
  templates: Record<string, unknown>;
}
export interface OntologyImportIssue { path: string; message: string }
export interface OntologyImportPreviewRequest {
  package: unknown;
  /** Optional candidate Genome; checked using this package and accepted dependencies. */
  genomeFiles?: Record<string, string>;
}
export interface OntologyImportReview {
  id: string;
  systemId: string;
  status: "invalid" | "review" | "accepted";
  createdAt: string;
  acceptedAt?: string;
  /** Execute locally after acceptance to create/push/import the reviewed Genome. */
  bootstrap?: { directory: string; args: string[] };
  /** Preserved even when invalid, so conversion errors remain inspectable. */
  package: unknown;
  pin?: OntologyPackagePin;
  templateRefs: string[];
  issues: OntologyImportIssue[];
  genomeFiles?: Record<string, string>;
}
export interface OntologyImportAcceptRequest { hash: string }
export interface OntologyImportsResponse { imports: OntologyImportReview[]; packages: OntologyPackagePin[] }
/** Creates a review destination; acceptance never implements or deploys a System. */
export interface CreateInitialSystemRequest { systemId: string; title?: string }
export interface CreateInitialSystemResponse { systemId: string; status: "import-pending"; reviewUrl: string }
