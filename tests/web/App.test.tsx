import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';

describe('App', () => {
  it('renders the validation baseline', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Findly' })).toBeInTheDocument();
  });
});
