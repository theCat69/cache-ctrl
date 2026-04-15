declare module "web-tree-sitter" {
  export interface SyntaxNode {
    readonly type: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly childCount: number;
    child(index: number): SyntaxNode | null;
  }

  export interface Tree {
    readonly rootNode: SyntaxNode;
  }

  export interface QueryCapture {
    readonly node: SyntaxNode;
  }

  export interface Query {
    captures(node: SyntaxNode): QueryCapture[];
  }

  export interface Language {
    query(query: string): Query;
  }

  export interface Parser {
    parse(input: string): Tree | null;
  }
}
