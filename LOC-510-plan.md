# Stall Detection Plan

## Analysis
The current implementation of `listIssueBlockerAttentionMap` in `src/services/issues.ts` has a classification logic for stalled paths:
- Issues are considered stalled if they are in `in_review` but lack a "waiting path" (no active run, no assigned user).
- It doesn't explicitly detect when an issue is *unassigned* and *blocked* with no progress.

## Goal
Improve stall detection to identify issues that have been blocked for too long without agent or human intervention, even if they aren't in `in_review`.

## Plan
1.  **Define Stalled Criteria**:
    - Unassigned or agent-assigned but not active for X days.
    - Blocked by a blocker that is also stalled or inactive.
2.  **Implementation**:
    - Update `classifyPath` in `src/services/issues.ts` to identify these stalled states.
    - Consider introducing an age-based threshold for stall detection.
3.  **Verification**:
    - Update existing tests in `src/__tests__/issue-blocker-attention.test.ts` to cover the new stall scenarios.
    - Run the tests to ensure no regressions.

## Todo
- [ ] Define "Stalled" criteria for blocked issues
- [ ] Implement stall detection logic in `classifyPath`
- [ ] Add/update tests in `src/__tests__/issue-blocker-attention.test.ts`
- [ ] Verify with tests
