PASS (code)

Fresh reviewer: /root/code_review_r3; review_kind=code; isolation_requirement=ordinary.
Snapshot: 89e4a4cbae991e01b163e11e8e0add6d6291f6222662b3e85c9679f58ba1a018. Scoped hashes verified.

P1 closed: observedTokenHighWater is monotonic and persisted independently of64-frame trace, included in retry floor; trace eviction and lower late terminal cannot erase peak for token/wall/preparation runaways.
P2 closed: recovery starts from latest optional history, appends later tool-count increments including anchor active tool, then bounds to8.
Regressions inspect peak200 evicted by69 lower frames, terminal108, retry150 refusal; history68 followed69/70.

No tests executed. Ordinary corrective review limited to source/frozen diff inspection. Release validation and final acceptance remain outside this code review.
