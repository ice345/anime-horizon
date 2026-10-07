import React from 'react';

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="grid min-h-56 place-items-center border-y border-yearbook-line px-5 text-center">
    <p className="ah-italic max-w-md font-display text-lg leading-7 text-yearbook-muted">{message}</p>
  </div>
);
