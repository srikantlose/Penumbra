import { Certificate } from './types.js';

export interface ValidationError {
  field: string;
  message: string;
  path: string;
}

export function validateCertificate(cert: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!cert.format_version || cert.format_version !== '0.1') {
    errors.push({
      field: 'format_version',
      message: 'Must be "0.1"',
      path: 'format_version'
    });
  }

  if (!cert.claim) {
    errors.push({
      field: 'claim',
      message: 'Claim is required',
      path: 'claim'
    });
  } else {
    const claimErrors = validateClaim(cert.claim);
    errors.push(...claimErrors);
  }

  if (!cert.rules || cert.rules !== 'standard') {
    errors.push({
      field: 'rules',
      message: 'Must be "standard"',
      path: 'rules'
    });
  }

  if (!cert.root_id || typeof cert.root_id !== 'string') {
    errors.push({
      field: 'root_id',
      message: 'Must be a non-empty string',
      path: 'root_id'
    });
  }

  if (!Array.isArray(cert.nodes) || cert.nodes.length === 0) {
    errors.push({
      field: 'nodes',
      message: 'Must be a non-empty array',
      path: 'nodes'
    });
  } else {
    cert.nodes.forEach((node, i) => {
      const nodeErrors = validateNode(node);
      errors.push(
        ...nodeErrors.map(e => ({
          ...e,
          path: `nodes[${i}].${e.path}`
        }))
      );
    });
  }

  if (!cert.dependencies || typeof cert.dependencies !== 'object') {
    errors.push({
      field: 'dependencies',
      message: 'Must be an object',
      path: 'dependencies'
    });
  }

  if (!cert.metadata || typeof cert.metadata !== 'object') {
    errors.push({
      field: 'metadata',
      message: 'Must be an object',
      path: 'metadata'
    });
  } else {
    if (!cert.metadata.producer || typeof cert.metadata.producer !== 'string') {
      errors.push({
        field: 'metadata.producer',
        message: 'Producer must be a non-empty string',
        path: 'metadata.producer'
      });
    }
    if (!cert.metadata.timestamp || typeof cert.metadata.timestamp !== 'string') {
      errors.push({
        field: 'metadata.timestamp',
        message: 'Timestamp must be a valid ISO string',
        path: 'metadata.timestamp'
      });
    }
  }

  return errors;
}

function validateClaim(claim: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!claim.fen || typeof claim.fen !== 'string') {
    errors.push({
      field: 'claim.fen',
      message: 'FEN must be a non-empty string',
      path: 'claim.fen'
    });
  }

  if (!claim.zobrist || !isValidZobrist(claim.zobrist)) {
    errors.push({
      field: 'claim.zobrist',
      message: 'Zobrist must be a valid hex string (0x...)',
      path: 'claim.zobrist'
    });
  }

  if (!claim.value || !['win', 'at_least_draw'].includes(claim.value)) {
    errors.push({
      field: 'claim.value',
      message: 'Value must be "win" or "at_least_draw"',
      path: 'claim.value'
    });
  }

  if (!claim.side || !['white', 'black'].includes(claim.side)) {
    errors.push({
      field: 'claim.side',
      message: 'Side must be "white" or "black"',
      path: 'claim.side'
    });
  }

  return errors;
}

function validateNode(node: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node.id || typeof node.id !== 'string') {
    errors.push({
      field: 'id',
      message: 'ID must be a non-empty string',
      path: 'id'
    });
  }

  if (!isValidZobrist(node.zobrist)) {
    errors.push({
      field: 'zobrist',
      message: 'Zobrist must be a valid hex string',
      path: 'zobrist'
    });
  }

  if (!['white', 'black'].includes(node.to_move)) {
    errors.push({
      field: 'to_move',
      message: 'to_move must be "white" or "black"',
      path: 'to_move'
    });
  }

  if (!['or-node', 'and-node', 'terminal'].includes(node.kind)) {
    errors.push({
      field: 'kind',
      message: 'kind must be "or-node", "and-node", or "terminal"',
      path: 'kind'
    });
  }

  if (node.kind !== 'terminal') {
    if (!Array.isArray(node.moves) || node.moves.length === 0) {
      errors.push({
        field: 'moves',
        message: 'Non-terminal nodes must have moves',
        path: 'moves'
      });
    } else {
      node.moves.forEach((move, i) => {
        if (!isValidUCI(move.uci)) {
          errors.push({
            field: 'moves[].uci',
            message: 'Invalid UCI notation',
            path: `moves[${i}].uci`
          });
        }
        if (!move.child_id) {
          errors.push({
            field: 'moves[].child_id',
            message: 'child_id is required',
            path: `moves[${i}].child_id`
          });
        }
      });
    }
  }

  return errors;
}

function isValidZobrist(zobrist: any): boolean {
  if (typeof zobrist !== 'string') return false;
  return /^0x[0-9a-f]{16}$/.test(zobrist);
}

function isValidUCI(uci: any): boolean {
  if (typeof uci !== 'string') return false;
  return /^[a-h][1-8][a-h][1-8]([qrbn])?$/.test(uci);
}
