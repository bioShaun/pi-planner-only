# Backend references

- Local kernel: Linux x86_64 6.17.0-41-generic; Landlock ABI7 query succeeded.
- /usr/include/linux/landlock.h and x86_64/asm-generic unistd headers: filesystem rights, packed path-beneath structure, syscalls444/445/446.
- https://docs.kernel.org/userspace-api/landlock.html : process and descendant inheritance, no_new_privs, minimum ABI3 for truncate, limitations for pre-opened FDs and metadata operations.
- https://raw.githubusercontent.com/containers/bubblewrap/v0.11.0/bubblewrap.c : bootstrap uses /tmp-based private tmpfs/newroot staging; not used in this implementation.
- Installed Pi Root append-system-prompt does not automatically propagate to independently constructed child system prompts. Root note requires forwarding; environment and kernel policy inheritance are independent of model compliance. No global role/config edits.
