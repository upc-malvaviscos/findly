import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';

describe('App', () => {
  it('renders the public enrollment page', async () => {
    render(<App />);

    expect(await screen.findByText('Findly')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Encuentra tu momento.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Email para tu galería/)).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
