/**
 * Cloud mission 1 — Landing zone basics (AZURE_ACCURACY §I).
 *
 * A new customer's tenant: two subscriptions sit under the Tenant root group, where Azure
 * puts every new subscription (I3). The player builds a small management group hierarchy
 * in the shape of the Azure landing zone (Platform / Landing zones → Corp) and files each
 * subscription under the right group (one parent each, I4).
 */
import { createCloudState } from '../model.js'
import * as op from '../operations.js'
import { managementGroupIs, subscriptionUnder } from './conditions.js'

// Self-made, fixed GUIDs so the mission is the same every time (and testable).
const TENANT = '3f1c9a2e-5b7d-4e8a-9c61-2d4b7a0e5f13'
export const SUB_CONNECTIVITY = '8a2d4f60-1c3e-4b5a-9d7f-6e0b2c4a1d35'
export const SUB_CORP_PROD = '5e7b1d93-2a4c-4f6e-8b0d-9c3a5e7f1b24'

function must(r) { if (!r.ok) throw new Error(`mission setup failed: ${r.message}`); return r.state }

export const landingZoneMission = {
  id: 'cloud_landing_zone',
  title: 'Landing zone basics',
  client: 'Contoso Ltd',
  summary: 'Organise a new tenant into management groups before any workload lands.',
  brief: [
    'Contoso has just signed up. Their two subscriptions — "Contoso Connectivity" for shared networking and '
      + '"Contoso Corp Production" for internal apps — are sitting under the Tenant root group, where Azure puts every '
      + 'new subscription.',
    'Before anyone deploys, set up a small hierarchy so access and policy can later be assigned once per group instead of '
      + 'per subscription. Use exactly these IDs — management group IDs are permanent; display names can change later.',
  ],
  objectives: [
    { id: 'platform', text: 'Create management group mg-platform (display name "Platform") under the Tenant root group.',
      hint: 'Select Tenant root group → "Add a management group under this one".',
      check: t => managementGroupIs(t, 'mg-platform', { displayName: 'Platform', parentId: TENANT }) },
    { id: 'landingzones', text: 'Create mg-landingzones ("Landing zones") under the Tenant root group.',
      hint: 'Same as Platform — both are direct children of the root.',
      check: t => managementGroupIs(t, 'mg-landingzones', { displayName: 'Landing zones', parentId: TENANT }) },
    { id: 'corp', text: 'Create mg-corp ("Corp") under Landing zones.',
      hint: 'Select Landing zones first, then add the group under it.',
      check: t => managementGroupIs(t, 'mg-corp', { displayName: 'Corp', parentId: 'mg-landingzones' }) },
    { id: 'move-connectivity', text: 'Move "Contoso Connectivity" under Platform.',
      hint: 'Select the subscription → "Move to a management group".',
      check: t => subscriptionUnder(t, SUB_CONNECTIVITY, 'mg-platform') },
    { id: 'move-corp', text: 'Move "Contoso Corp Production" under Corp.',
      hint: 'A subscription has exactly one parent — moving it takes it out of the root.',
      check: t => subscriptionUnder(t, SUB_CORP_PROD, 'mg-corp') },
  ],
  learn: ['I1', 'I3', 'I4', 'I5', 'I8'],
  debrief: [
    'Every tenant has one root management group; new subscriptions land there until someone files them.',
    'A management group or subscription has one parent; a tree can go six levels below the root.',
    'Anything assigned to Landing zones will now apply to Corp and to every subscription under it.',
  ],
  setup() {
    let s = createCloudState({ tenantId: TENANT })
    s = must(op.addSubscription(s, { id: SUB_CONNECTIVITY, displayName: 'Contoso Connectivity' }))
    s = must(op.addSubscription(s, { id: SUB_CORP_PROD, displayName: 'Contoso Corp Production' }))
    return s
  },
}
